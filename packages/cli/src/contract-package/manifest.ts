import { createHash } from 'node:crypto';
import {
  type ApplicationSnapshot,
  byCodePoint,
  hashedTextOf,
  isSubscriptionTombstone,
  messageIdentityOf,
  type PeerRanges,
  type PublishedApplicationSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  readEventReference,
  type ServiceSnapshot,
  type Snapshot,
} from '@cf-loom/contract/internal';
import type { PackageFile } from './modules.ts';
import { builtFolder, packagePaths } from './paths.ts';

/** Who the package is published as, at which version, and the peer ranges it declares. */
export type Packaging = {
  readonly name: string;
  readonly version: string;
  readonly peerRanges: PeerRanges;
};

/** The Snapshot a Contract Package is generated from: declared by `package`, published by `publish`. */
export type ContractSnapshot =
  | ServiceSnapshot
  | ApplicationSnapshot
  | PublishedServiceSnapshot
  | PublishedApplicationSnapshot;

/**
 * The package.json: named as the project publishes, at its version, with its code if it has any,
 * the peer ranges it is given unless there are none, and the `cfLoom` metadata: the hash and kind
 * the check reads without downloading the package, and its Dependencies.
 */
export function manifestOf(
  snapshot: ContractSnapshot,
  { name, version, peerRanges }: Packaging,
): PackageFile {
  const peers = Object.keys(peerRanges).length === 0 ? {} : { peerDependencies: peerRanges };
  const cfLoom = cfLoomOf(snapshot);
  return manifestFileOf({ name, version, ...codeFieldsOf(snapshot.kind), ...peers, cfLoom });
}

/** What a package exports and ships: a Service's built code, and for every kind its `package.json` and `snapshot.json`. */
function codeFieldsOf(kind: ContractSnapshot['kind']) {
  switch (kind) {
    case 'service': {
      const code = { types: `./${builtFolder}/index.d.ts`, default: `./${builtFolder}/index.js` };
      const exports = { '.': code, ...fileExports };
      return {
        type: 'module',
        exports,
        files: [builtFolder, packagePaths.snapshot],
        sideEffects: false,
      };
    }
    case 'application':
      return { exports: fileExports, files: [packagePaths.snapshot] };
  }
}

/** The two files every Contract Package exports, which a Consumer's tooling reads by name. */
const fileExports = {
  './package.json': `./${packagePaths.manifest}`,
  './snapshot.json': `./${packagePaths.snapshot}`,
};

/** A package.json from its fields: two-space JSON and a final line break. */
export function manifestFileOf(manifest: object): PackageFile {
  return { path: packagePaths.manifest, text: `${JSON.stringify(manifest, null, 2)}\n` };
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

/**
 * Each Dependency as the Snapshot records it, with the Events received from its Provider, which
 * the Snapshot keeps only in the Subscriptions, so the registry's metadata records every use of a
 * Provider's Elements.
 */
function dependenciesOf(snapshot: Snapshot | PublishedSnapshot) {
  switch (snapshot.kind) {
    case 'service':
      return withEventsOf(snapshot.dependencies, receivedEventsOf(snapshot.subscriptions));
    case 'application':
      return withEventsOf(snapshot.dependencies, []);
    case 'definitions':
      return {};
  }
}

function withEventsOf(
  dependencies: PublishedServiceSnapshot['dependencies'],
  received: readonly EventReference[],
) {
  const entries = Object.entries(dependencies).map(([provider, dependency]) => {
    const events = received.filter((event) => event.service === provider);
    const identities = new Set(events.map(({ name, version }) => messageIdentityOf(name, version)));
    return [provider, { ...dependency, events: [...identities].sort(byCodePoint) }] as const;
  });
  return Object.fromEntries(entries);
}

/** The Events a Service's Subscriptions receive, a removed Subscription's not among them. */
function receivedEventsOf(
  subscriptions: PublishedServiceSnapshot['subscriptions'],
): readonly EventReference[] {
  const received: EventReference[] = [];
  for (const subscription of Object.values(subscriptions)) {
    const reference = readEventReference(subscription.event);
    if (!isSubscriptionTombstone(subscription) && reference !== undefined) {
      received.push(reference);
    }
  }
  return received;
}

type EventReference = NonNullable<ReturnType<typeof readEventReference>>;

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
