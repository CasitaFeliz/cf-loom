import type { Definitions } from '../declarations/index.ts';
import type { ValidatedSchemas } from '../validation/index.ts';
import type { ResolvedStandard } from '../written/index.ts';

/**
 * A Definitions Package installed where the root is validated: its Definitions object, the
 * package.json name and exact version, which the Snapshot records, and what its module exports,
 * by name.
 */
export type ResolvedDefinitions = {
  readonly definitions: Definitions;
  readonly packageName: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
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
