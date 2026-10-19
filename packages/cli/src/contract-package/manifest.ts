import type { ApplicationSnapshot, ServiceSnapshot } from '@casitafeliz/loom-contract/internal';
import { snapshotHashOf } from './hash.ts';
import type { PackageFile } from './modules.ts';
import { packagePaths } from './paths.ts';

/** The versions of the two peers the package is built with, as installed beside the root. */
export type Peers = { readonly contract: string; readonly zod: string };

/** Who the package is published as, at which version, and what it is built with. */
export type Packaging = { readonly scope: string; readonly version: string; readonly peers: Peers };

/**
 * The package.json: named `<scope>/contract-<name>`, at its version, peers on `zod` and
 * `@casitafeliz/loom-contract` only with a caret on the versions built with, and the `cfLoom`
 * metadata the dependency graph is read from.
 */
export function manifestOf(
  snapshot: ServiceSnapshot | ApplicationSnapshot,
  { scope, version, peers }: Packaging,
): PackageFile {
  const manifest = {
    name: `${scope}/contract-${snapshot.name}`,
    version,
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    files: ['dist', packagePaths.snapshot],
    sideEffects: false,
    peerDependencies: {
      '@casitafeliz/loom-contract': `^${peers.contract}`,
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
      outDir: 'dist',
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
