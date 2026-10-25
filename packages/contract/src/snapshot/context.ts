import type { ResolvedDefinitions, ValidatedSchemas } from '../validation/index.ts';
import type { ResolvedStandard } from '../written/index.ts';

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
