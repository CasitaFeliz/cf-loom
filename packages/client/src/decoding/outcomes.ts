import type { Endpoint, RejectionsOf, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type Issue,
  type Parsed,
  type ReceivedInvalidInputBody,
  reservedFaults,
} from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';
import type { AnyDependencies } from '../endpoints/index.ts';
import type { ReceivedFault } from '../inference/index.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : undefined;

/** A Success as decoded, before its Endpoint types it: its body and declared headers, read. */
export type DecodedSuccess = {
  readonly kind: 'success';
  readonly value: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
};

/** A Rejection as decoded, before its Endpoint types it: one it answers, or an unknown code. */
export type DecodedRejection = {
  readonly kind: 'rejection';
  readonly known: boolean;
  readonly code: string;
  readonly message: string;
  readonly body: unknown;
};

/** The Outcome a Caller receives, before its type is told by its Endpoint. */
export type DecodedOutcome = DecodedSuccess | DecodedRejection | ReceivedFault;

/** A Success as a Caller receives it: its body as `value` and its declared headers, both read. */
export type ReceivedSuccess<Target extends Endpoint> = Omit<DecodedSuccess, 'value' | 'headers'> & {
  readonly value: Target['success'] extends { readonly body: infer Body }
    ? Output<Body>
    : undefined;
  readonly headers: Target['success'] extends { readonly headers: infer Headers }
    ? Output<Headers>
    : Readonly<Record<never, never>>;
};

/** A Rejection whose code the Caller knows, so checking `known` narrows by `code`. */
type KnownRejection<Code, Body> = DecodedRejection & {
  readonly known: true;
  readonly code: Code;
  readonly body: Body;
};

/** A Rejection with a code the Caller does not know: codes are open, its body unvalidated. */
type UnknownRejection = DecodedRejection & { readonly known: false };

/** A Rejection an Endpoint answers, as received: a Standard one by its Provider's code. */
type KnownRejectionOf<Answerable, Standards extends StandardRejections> = Answerable extends {
  readonly kind: 'standard-rejection';
  readonly name: infer Name extends keyof StandardRejections;
}
  ? KnownRejection<
      Standards[Name]['code'],
      Name extends 'invalidInput' ? ReceivedInvalidInputBody : undefined
    >
  : Answerable extends { readonly kind: 'rejection'; readonly code: infer Code }
    ? KnownRejection<
        Code,
        Answerable extends { readonly body: infer Body } ? Output<Body> : undefined
      >
    : never;

/** A Rejection as a Caller receives it: one its Endpoint answers, or one with an unknown code. */
export type ReceivedRejection<Target extends Endpoint, Standards extends StandardRejections> =
  | KnownRejectionOf<RejectionsOf<Target>, Standards>
  | UnknownRejection;

/** The Outcome a Caller receives from one Endpoint of a Dependency: a Success, a Rejection or a Fault. */
export type ReceivedOutcome<
  Deps extends AnyDependencies,
  Name extends keyof Deps['endpoints'],
> = Deps['endpoints'][Name] extends infer Target extends Endpoint
  ? ReceivedSuccess<Target> | ReceivedRejection<Target, Deps['standardRejections']> | ReceivedFault
  : never;

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
