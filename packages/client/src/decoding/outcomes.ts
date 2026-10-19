import { type Issue, type Parsed, reservedFaults } from '@casitafeliz/loom-contract/internal';
import type { ReceivedFault } from '../inference/index.ts';

/** A Success as decoded: its body and declared headers, read with their Reader schemas. */
export type DecodedSuccess = {
  readonly kind: 'success';
  readonly value: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
};

/** A Rejection as decoded: one the Endpoint answers, its body read, or a code it does not know. */
export type DecodedRejection = {
  readonly kind: 'rejection';
  readonly known: boolean;
  readonly code: string;
  readonly message: string;
  readonly body: unknown;
};

/** The Outcome a Caller receives, before its type is told by its Endpoint. */
export type DecodedOutcome = DecodedSuccess | DecodedRejection | ReceivedFault;

/** What broke the Contract in an answer, and whether the Provider had committed it. */
export type BrokenOutcome = {
  readonly committed: 'yes' | 'unknown';
  readonly issues: readonly Issue[];
};

/** The client's own `INVALID_OUTCOME`: never retryable, with the Issues, never the value. */
export function invalidOutcomeOf({ committed, issues }: BrokenOutcome): ReceivedFault {
  const { message } = reservedFaults.INVALID_OUTCOME;
  return { kind: 'fault', code: 'INVALID_OUTCOME', committed, retryable: false, message, issues };
}

/** The Issues of a value read at a part of the answer; none when it was read. */
export function issuesAt(part: Issue['part'], parsed: Parsed): readonly Issue[] {
  return parsed.kind === 'issues' ? parsed.issues.map((issue) => ({ part, ...issue })) : [];
}
