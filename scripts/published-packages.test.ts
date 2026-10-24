import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { targetsOf } from './package-entries.ts';

type WorkspacePackage = { readonly name: string; readonly path: string; readonly private: boolean };

type PackedPackage = {
  readonly name: string;
  readonly path: string;
  readonly files: ReadonlySet<string>;
  readonly manifest: { readonly exports?: unknown; readonly bin?: unknown };
};

const root = join(import.meta.dirname, '..');

/** Runs the `pnpm` on `PATH`, which must be the version `packageManager` names, or pnpm fetches that one. */
function pnpm(args: string[], cwd: string): string {
  return execFileSync('pnpm', args, { cwd, encoding: 'utf8' });
}

function workspacePackages(): WorkspacePackage[] {
  return JSON.parse(pnpm(['ls', '-r', '--depth', '-1', '--json'], root));
}

function packed({ name, path }: WorkspacePackage): PackedPackage {
  const { files } = JSON.parse(pnpm(['pack', '--dry-run', '--json'], path));
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

describe('the packages pnpm publishes', () => {
  it('are the ones under packages/, named @cf-loom/<folder>, and no other workspace package', () => {
    const published = workspacePackages()
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

    beforeAll(() => {
      const published = workspacePackages().filter((workspacePackage) => !workspacePackage.private);
      packages = published.map(packed);
    }, 120_000);

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
  });
});
