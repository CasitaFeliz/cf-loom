import type { Endpoint } from '../declarations/index.ts';
import { attachmentsOf, demandParts, type Issue, schemaOf } from '../validation/index.ts';
import { parsedPartsOf } from './parsed-parts.ts';

/** An Issue in what a Guard demands of a request. */
export type DemandIssue = Issue & { readonly part: (typeof demandParts)[number] };

/**
 * What a request breaks of its Endpoint's Guards' demands, read in Attachment order: the first
 * Guard whose demands fail answers alone, as the Provider's would before any other reads it.
 */
export function demandIssuesOf(endpoint: Endpoint, given: unknown): readonly DemandIssue[] {
  for (const { guard } of attachmentsOf(endpoint)) {
    const demands = parsedPartsOf(demandParts, (part) => schemaOf(guard, part), given);
    if (demands.kind === 'issues') {
      return demands.issues;
    }
  }
  return [];
}
