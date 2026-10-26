import type { ResolvedDefinitions, ValidatedSchemas } from '../validation/index.ts';
import type { ResolvedStandard } from '../written/index.ts';

/** What a declared Snapshot is built with besides the valid Root: the CLI that writes it. */
export type SnapshotContext = {
  readonly generator: string;
};

/** What every entry of a Snapshot reads besides its own declaration. */
export type SnapshotSources = {
  readonly nodeOf: ValidatedSchemas['nodeOf'];
  readonly standards: readonly ResolvedStandard[];
  readonly standardRejectionsSource: ResolvedDefinitions | undefined;
};
