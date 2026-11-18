import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runForOutput } from '../packages/messaging/test/test-process.ts';
import { targetsOf } from './package-entries.ts';

type WorkspacePackage = { readonly name: string; readonly path: string; readonly private: boolean };

type PackedPackage = {
  readonly name: string;
  readonly path: string;
  readonly files: ReadonlySet<string>;
  readonly manifest: {
    readonly exports?: unknown;
    readonly bin?: unknown;
    readonly license?: unknown;
    readonly publishConfig?: { readonly access?: unknown };
  };
};

const licenseFiles = ['LICENSE-MIT', 'LICENSE-APACHE'];

const root = join(import.meta.dirname, '..');

/** Runs the `pnpm` on `PATH`, which must be the version `packageManager` names, or pnpm fetches that one. */
function pnpm(args: string[], cwd: string): Promise<string> {
  return runForOutput('pnpm', args, { cwd });
}

async function workspacePackages(): Promise<WorkspacePackage[]> {
  return JSON.parse(await pnpm(['ls', '-r', '--depth', '-1', '--json'], root));
}

async function packed({ name, path }: WorkspacePackage): Promise<PackedPackage> {
  const { files } = JSON.parse(await pnpm(['pack', '--dry-run', '--json'], path));
  return {
    name,
    path,
    files: new Set(files.map((file: { path: string }) => file.path)),
    manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')),
  };
}

function sourcesOf(packageDir: string): string[] {
  const entries = readdirSync(join(packageDir, 'src'), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(packageDir, join(entry.parentPath, entry.name)));
}

function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

/**
 * A module statement as `tsc` writes it, one per line: `import`/`export … from '…';`, a bare
 * `import '…';`, or a type's `import('…')`; a regex literal in emitted code is none.
 */
const importPattern =
  /^(?:(?:import|export)\b[^'"\n;]*?\s|\}\s*)from\s*['"]([^'"]+)['"];$|^import\s*['"]([^'"]+)['"];$|import\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** The package a bare specifier names: `@scope/name` or `name`, without its subpath. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('node:') &&
    !builtinModules.includes(specifier)
  );
}

/** The packages a package's built `.js` and `.d.ts` files import, itself left out. */
function importedPackagesOf(packageDir: string, self: string): Set<string> {
  const entries = readdirSync(join(packageDir, 'dist'), { recursive: true, withFileTypes: true });
  const built = entries.filter(
    (entry) => entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')),
  );
  const imported = new Set<string>();
  for (const file of built) {
    const text = readFileSync(join(file.parentPath, file.name), 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? '';
      if (isBareSpecifier(specifier)) {
        imported.add(packageNameOf(specifier));
      }
    }
  }
  imported.delete(self);
  return imported;
}

describe('the packages pnpm publishes', () => {
  it('are the ones under packages/, named @cf-loom/<folder>, and no other workspace package', async () => {
    const published = (await workspacePackages())
      .filter((workspacePackage) => !workspacePackage.private)
      .map(({ name, path }) => ({ path: relative(root, path), name }));
    const expected = readdirSync(join(root, 'packages')).map((folder) => ({
      path: `packages/${folder}`,
      name: `@cf-loom/${folder}`,
    }));

    expect(published.sort(byPath)).toEqual(expected.sort(byPath));
  });

  describe('each @cf-loom package', () => {
    let packages: PackedPackage[];

    beforeAll(async () => {
      const published = (await workspacePackages()).filter(
        (workspacePackage) => !workspacePackage.private,
      );
      packages = [];
      for (const workspacePackage of published) {
        packages.push(await packed(workspacePackage));
      }
    });

    it('packs every file its exports and bin point at', () => {
      const missing = packages.flatMap(({ name, files, manifest }) => {
        const targets = [...targetsOf(manifest.exports), ...targetsOf(manifest.bin)];
        const expected = targets.map((target) => posix.normalize(target));
        return expected.filter((path) => !files.has(path)).map((path) => `${name}: ${path}`);
      });

      expect(missing).toEqual([]);
    });

    it('packs its README', () => {
      const without = packages.filter(({ files }) => !files.has('README.md'));

      expect(without.map(({ name }) => name)).toEqual([]);
    });

    it('packs its sources without their tests', () => {
      const packedSources = Object.fromEntries(
        packages.map(({ name, files }) => [
          name,
          [...files].filter((path) => path.startsWith('src/')).sort(),
        ]),
      );
      const sourcesWithoutTests = Object.fromEntries(
        packages.map(({ name, path }) => [
          name,
          sourcesOf(path)
            .filter((source) => !source.endsWith('.test.ts'))
            .sort(),
        ]),
      );

      expect(packedSources).toEqual(sourcesWithoutTests);
    });

    it('does not pack its ARCHITECTURE.md, which is for the repository', () => {
      const packing = packages.filter(({ files }) => files.has('ARCHITECTURE.md'));

      expect(packing.map(({ name }) => name)).toEqual([]);
    });

    it("holds LICENSE-MIT and LICENSE-APACHE in its folder and its pack, each the same as the repository's root one", () => {
      const problems = packages.flatMap(({ name, path, files }) =>
        licenseFiles.flatMap((file) => {
          if (!files.has(file)) {
            return [`${name}: ${file} missing`];
          }
          const same = readFileSync(join(path, file)).equals(readFileSync(join(root, file)));
          return same ? [] : [`${name}: ${file} differs from the root one`];
        }),
      );

      expect(problems).toEqual([]);
    });

    it('declares the license (MIT OR Apache-2.0)', () => {
      const other = packages.filter(({ manifest }) => manifest.license !== '(MIT OR Apache-2.0)');

      expect(other.map(({ name }) => name)).toEqual([]);
    });

    it('publishes with access public, as .changeset/config.json says', () => {
      const changesetsConfig = JSON.parse(
        readFileSync(join(root, '.changeset', 'config.json'), 'utf8'),
      );
      const notPublic = [
        ...packages
          .filter(({ manifest }) => manifest.publishConfig?.access !== 'public')
          .map(({ name }) => name),
        ...(changesetsConfig.access === 'public' ? [] : ['.changeset/config.json']),
      ];

      expect(notPublic).toEqual([]);
    });
  });

  it('import from their built files only the packages their peers and dependencies list', () => {
    const undeclared = readdirSync(join(root, 'packages')).flatMap((folder) => {
      const packageDir = join(root, 'packages', folder);
      const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
      const declared = new Set([
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.dependencies ?? {}),
      ]);
      const imported = [...importedPackagesOf(packageDir, manifest.name)];
      return imported
        .filter((name) => !declared.has(name))
        .map((name) => `${manifest.name}: ${name}`);
    });

    expect(undeclared).toEqual([]);
  });
});
