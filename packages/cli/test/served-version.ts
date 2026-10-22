import { canonicalTextOf } from '@cf-loom/contract/internal';
import { aPublishedSnapshot, type Declared, orders } from './published-snapshot.ts';
import { aPackageTarball } from './tarball.ts';

/** A version of a package as the fake registry serves it: its manifest, its tarball and its `dist`. */
export type ServedVersion = {
  readonly version: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tarball: Buffer;
  readonly packed: Buffer | undefined;
  readonly dist: Readonly<Record<string, unknown>> | null;
};

export type VersionOptions = {
  readonly declared?: Declared;
  readonly peers?: Readonly<Record<string, string>>;
  readonly deprecated?: string;
  readonly cfLoom?: Readonly<Record<string, unknown>> | null;
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly snapshotJson?: Buffer | string;
  readonly tarball?: Buffer;
  readonly packed?: Buffer;
  readonly dist?: Readonly<Record<string, unknown>> | null;
};

export function aVersion(version: string, options: VersionOptions = {}): ServedVersion {
  const declared = options.declared ?? orders;
  const snapshotJson =
    options.snapshotJson ?? canonicalTextOf(aPublishedSnapshot(declared, version));
  const defaultCfLoom = { format: 1, snapshotHash: 'a'.repeat(64), kind: declared.kind };
  const cfLoom = options.cfLoom === undefined ? defaultCfLoom : options.cfLoom;
  const manifest = {
    version,
    ...(cfLoom === null ? {} : { cfLoom }),
    ...(options.peers === undefined ? {} : { peerDependencies: options.peers }),
    ...(options.deprecated === undefined ? {} : { deprecated: options.deprecated }),
    ...options.manifest,
  };
  const tarball = options.tarball ?? aPackageTarball(snapshotJson);
  const dist = options.dist === undefined ? {} : options.dist;
  return { version, manifest, tarball, packed: options.packed, dist };
}
