export { compatibilityReportOf } from './check.ts';
export { firstPublishChangesOf } from './element-changes.ts';
export type { GraftTarget } from './grafting.ts';
export { graftedInputOf, readDefsOf } from './grafting.ts';
export { publishedSnapshotOf } from './merge.ts';
export type { PeerMove, PeerRangeMove, PeerRanges } from './peers.ts';
export { peerMovesOf, zodPeerRange } from './peers.ts';
export type {
  Change,
  ChangeClass,
  ChangeSite,
  ComparedReport,
  Difference,
  Position,
  Verdict,
} from './report.ts';
export type { ShapeDifference } from './shape-differences.ts';
export { versionBumpOf } from './versioning.ts';
