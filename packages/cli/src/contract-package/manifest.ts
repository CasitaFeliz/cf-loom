import { createHash } from 'node:crypto';
import {
  type ApplicationSnapshot,
  hashedTextOf,
  type PeerRanges,
  type PublishedApplicationSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { publishedNameOf } from '../loading/index.ts';
import type { PackageFile } from './modules.ts';
import { builtFolder, packagePaths } from './paths.ts';

/** The versions of the two peers the package is built with, as installed beside the root. */
export type Peers = { readonly contract: string; readonly zod: string };

/** Who the package is published as, at which version, and what it is built with. */
export type Packaging = { readonly scope: string; readonly version: string; readonly peers: Peers };

/** The Snapshot a Contract Package is generated from: declared by `package`, published by `publish`. */
export type ContractSnapshot =
  | ServiceSnapshot
  | ApplicationSnapshot
  | PublishedServiceSnapshot
  | PublishedApplicationSnapshot;

/**
 * The package.json: named `<scope>/contract-<name>`, at its version, peers on `zod` and
 * `@cf-loom/contract` only with a caret on the versions built with, and the `cfLoom` metadata:
 * the hash and kind the check reads without downloading the package, and its Dependencies.
 */
export function manifestOf(
  snapshot: ContractSnapshot,
  { scope, version, peers }: Packaging,
): PackageFile {
  const manifest = {
    name: publishedNameOf(scope, snapshot),
    version,
    type: 'module',
    exports: {
      '.': { types: `./${builtFolder}/index.d.ts`, default: `./${builtFolder}/index.js` },
    },
    files: [builtFolder, packagePaths.snapshot],
    sideEffects: false,
    peerDependencies: peerRangesOf(peers),
    cfLoom: cfLoomOf(snapshot),
  };
  return manifestFileOf(manifest);
}

/** A package.json from its fields: two-space JSON and a final line break. */
export function manifestFileOf(manifest: object): PackageFile {
  return { path: packagePaths.manifest, text: `${JSON.stringify(manifest, null, 2)}\n` };
}

/** The peer ranges a package declares: a caret on each version it is built with. */
export function peerRangesOf(peers: Peers): PeerRanges {
  return { '@cf-loom/contract': `^${peers.contract}`, zod: `^${peers.zod}` };
}

/**
 * The `cfLoom` metadata every package carries: the Snapshot's format, hash and kind, and its
 * Dependencies, which a Definitions Package has none of.
 */
export function cfLoomOf(snapshot: Snapshot | PublishedSnapshot) {
  return {
    format: snapshot.format,
    snapshotHash: snapshotHashOf(snapshot),
    kind: snapshot.kind,
    dependencies: dependenciesOf(snapshot),
  };
}

function dependenciesOf(snapshot: Snapshot | PublishedSnapshot) {
  switch (snapshot.kind) {
    case 'service':
    case 'application':
      return snapshot.dependencies;
    case 'definitions':
      return {};
  }
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
export function snapshotHashOf(snapshot: Snapshot | PublishedSnapshot): string {
  return createHash('sha256').update(hashedTextOf(snapshot), 'utf8').digest('hex');
}
