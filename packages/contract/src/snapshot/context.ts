import type { Definitions } from '../declarations/index.ts';
import type { ResolvedStandard, ValidatedSchemas } from '../validation/index.ts';

/**
 * A Definitions Package a Contract lists, as installed where its Snapshot is built: the package
 * it is published as and the exact version resolved, which the Snapshot records.
 */
export type ResolvedDefinitions = {
  readonly definitions: Definitions;
  readonly packageName: string;
  readonly version: string;
};

/**
 * What a declared Snapshot is built with besides the valid root: the CLI that writes it, the
 * Definitions Packages as installed, the committed Snapshot's content, and the clock that stamps
 * `deprecatedAt`, so the same inputs always give the same Snapshot.
 */
export type SnapshotContext = {
  readonly generator: string;
  readonly packages: readonly ResolvedDefinitions[];
  readonly committed: unknown;
  readonly now: number;
};

/** What every entry of a Snapshot reads besides its own declaration. */
export type SnapshotSources = {
  readonly nodeOf: ValidatedSchemas['nodeOf'];
  readonly standards: readonly ResolvedStandard[];
  readonly packages: readonly ResolvedDefinitions[];
};
