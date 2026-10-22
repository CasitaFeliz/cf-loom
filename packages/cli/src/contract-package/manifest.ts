import { createHash } from 'node:crypto';
import {
  type ApplicationSnapshot,
  hashedTextOf,
  type ServiceSnapshot,
  type Snapshot,
} from '@cf-loom/contract/internal';
import type { PackageFile } from './modules.ts';
import { builtFolder, packagePaths } from './paths.ts';

/** The versions of the two peers the package is built with, as installed beside the root. */
export type Peers = { readonly contract: string; readonly zod: string };

/** Who the package is published as, at which version, and what it is built with. */
export type Packaging = { readonly scope: string; readonly version: string; readonly peers: Peers };

/**
 * The package.json: named `<scope>/contract-<name>`, at its version, peers on `zod` and
 * `@cf-loom/contract` only with a caret on the versions built with, and the `cfLoom` metadata:
 * the hash and kind the check reads without downloading the package, and its Dependencies.
 */
export function manifestOf(
  snapshot: ServiceSnapshot | ApplicationSnapshot,
  { scope, version, peers }: Packaging,
): PackageFile {
  const manifest = {
    name: `${scope}/contract-${snapshot.name}`,
    version,
    type: 'module',
    exports: {
      '.': { types: `./${builtFolder}/index.d.ts`, default: `./${builtFolder}/index.js` },
    },
    files: [builtFolder, packagePaths.snapshot],
    sideEffects: false,
    peerDependencies: {
      '@cf-loom/contract': `^${peers.contract}`,
      zod: `^${peers.zod}`,
    },
    cfLoom: {
      format: snapshot.format,
      snapshotHash: snapshotHashOf(snapshot),
      kind: snapshot.kind,
      dependencies: snapshot.dependencies,
    },
  };
  return { path: packagePaths.manifest, text: `${JSON.stringify(manifest, null, 2)}\n` };
}

/**
 * The package's own build: strict, no Node or DOM types since Applications import it in
 * browsers, `.ts` imports rewritten, `src` to `dist` with declarations.
 */
export function tsconfigOf(): PackageFile {
  const tsconfig = {
    compilerOptions: {
      declaration: true,
      erasableSyntaxOnly: true,
      lib: ['ES2024'],
      module: 'nodenext',
      moduleResolution: 'nodenext',
      outDir: builtFolder,
      rewriteRelativeImportExtensions: true,
      rootDir: 'src',
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      types: [],
      verbatimModuleSyntax: true,
    },
    include: ['src'],
  };
  return { path: packagePaths.tsconfig, text: `${JSON.stringify(tsconfig, null, 2)}\n` };
}

/**
 * The Snapshot's hash, as `cfLoom.snapshotHash` carries it: the SHA-256 of its canonical text
 * without `version` and `generator`, in lowercase hex.
 */
export function snapshotHashOf(snapshot: Snapshot): string {
  return createHash('sha256').update(hashedTextOf(snapshot), 'utf8').digest('hex');
}
