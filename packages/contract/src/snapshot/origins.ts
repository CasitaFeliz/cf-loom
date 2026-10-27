import { originTextOf, type ResolvedDefinitions } from '../validation/index.ts';
import type { Origin } from '../walker/index.ts';
import type { ResolvedStandard } from '../written/index.ts';

/** Where a Guard or a code came from: the Definitions Package it belongs to, at the version installed, else the Root's own. */
export function packageOriginOf(from: ResolvedDefinitions | undefined): Origin {
  return from === undefined ? 'local' : originTextOf(from);
}

/**
 * cf-loom's defaults are `standard`; a declared one comes from the package the Contract takes its
 * Standard Rejections from, or is a Definitions Package's own.
 */
export function standardOriginOf(
  { declared }: ResolvedStandard,
  standardRejectionsSource: ResolvedDefinitions | undefined,
): Origin {
  return declared === undefined ? 'standard' : packageOriginOf(standardRejectionsSource);
}
