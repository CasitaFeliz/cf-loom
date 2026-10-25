import type {
  Endpoint,
  Issue,
  ProvidedStandardRejections,
  RejectionsOf,
  SuccessOf,
} from '@cf-loom/contract';
import { type Parsed, reservedFaults } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import type { AnyDependency, ListedEndpoint, ListedName } from '../endpoints/index.ts';
import type { ReceivedFault } from '../inference/index.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : undefined;

/** A Success as decoded, before its Endpoint types it: its status, and the headers and body it declares, read. */
export type DecodedSuccess = {
  readonly kind: 'success';
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
};

/** Who answered a Rejection: the Provider, or the client alone when it refused the Input unsent. */
export type RejectionSource = 'provider' | 'client';

/** A Rejection as decoded, before its Endpoint types it: one it answers, its body where its code declares one. */
export type DecodedRejection = {
  readonly kind: 'rejection';
  readonly source: RejectionSource;
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly body?: unknown;
};

/** A Rejection with a code the Caller does not know: codes are open, its body unvalidated. */
export type ReceivedUnknownRejection = {
  readonly kind: 'unknown-rejection';
  readonly source: 'provider';
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly body?: unknown;
};

/** The Outcome a Caller receives, before its type is told by its Endpoint. */
export type DecodedOutcome =
  | DecodedSuccess
  | DecodedRejection
  | ReceivedUnknownRejection
  | ReceivedFault;

/** A Success as a Caller receives it from an Endpoint: what a direct call of its EndpointHandler returns. */
export type EndpointSuccess<Target extends Endpoint> = {
  readonly kind: 'success';
} & SuccessOf<Target>;

/** A Rejection an Endpoint answers, before its body: who answered it, its code, the status it arrived with and its message. */
type Received<Code, Source extends RejectionSource> = {
  readonly kind: 'rejection';
  readonly source: Source;
  readonly code: Code;
  readonly status: number;
  readonly message: string;
};

/** A declared Rejection's body, present only where its code declares one. */
type DeclaredBodyOf<Answerable> = Answerable extends { readonly body: infer Body }
  ? { readonly body: Output<Body> }
  : Readonly<Record<never, never>>;

/** A Standard Rejection by its Provider's code; only invalid input has a body, and the client may have answered it. */
type StandardRejectionOf<
  Name extends keyof ProvidedStandardRejections,
  Standards extends ProvidedStandardRejections,
> = Name extends 'invalidInput'
  ? Received<Standards['invalidInput']['code'], RejectionSource> & {
      readonly body: core.output<Standards['invalidInput']['body']>;
    }
  : Received<Standards[Name]['code'], 'provider'>;

/** A Rejection an Endpoint answers, as received: a Standard one by its Provider's code. */
type KnownRejectionOf<
  Answerable,
  Standards extends ProvidedStandardRejections,
> = Answerable extends {
  readonly kind: 'standard-rejection';
  readonly name: infer Name extends keyof ProvidedStandardRejections;
}
  ? StandardRejectionOf<Name, Standards>
  : Answerable extends { readonly kind: 'rejection'; readonly code: infer Code }
    ? Received<Code, 'provider'> & DeclaredBodyOf<Answerable>
    : never;

/** The Rejections an Endpoint answers as a Caller receives them, each with the body its code declares. */
export type EndpointRejection<
  Target extends Endpoint,
  Standards extends ProvidedStandardRejections,
> = KnownRejectionOf<RejectionsOf<Target>, Standards>;

/** A Success as a Caller receives it from the method `Name`: its status, and its headers and body where declared. */
export type ReceivedSuccess<D extends AnyDependency, Name extends ListedName<D>> =
  ListedEndpoint<D, Name> extends infer Target extends Endpoint ? EndpointSuccess<Target> : never;

/**
 * A Rejection the method `Name` answers, as a Caller receives it: its code, a Standard one the
 * Provider's, the status it arrived with, its message, and its body where its code declares one;
 * `source` is `client` for the invalid-input Rejection the client answered without sending.
 */
export type ReceivedRejection<D extends AnyDependency, Name extends ListedName<D>> =
  ListedEndpoint<D, Name> extends infer Target extends Endpoint
    ? EndpointRejection<Target, D['provider']['standardRejections']>
    : never;

/** The Outcome a Caller receives from one Endpoint of a Dependency: a Success, a Rejection, an unknown Rejection or a Fault. */
export type ReceivedOutcome<D extends AnyDependency, Name extends ListedName<D>> =
  | ReceivedSuccess<D, Name>
  | ReceivedRejection<D, Name>
  | ReceivedUnknownRejection
  | ReceivedFault;

/** What broke the Contract in an answer, the status it came with, and whether the Provider had committed it. */
export type BrokenOutcome = {
  readonly status: number;
  readonly committed: 'yes' | 'unknown';
  readonly issues: readonly Issue[];
};

/** The client's own `INVALID_OUTCOME`: never retryable, with the Issues, never the value. */
export function invalidOutcomeOf({ status, committed, issues }: BrokenOutcome): ReceivedFault {
  const { message } = reservedFaults.INVALID_OUTCOME;
  const source = 'invalid-outcome';
  return {
    kind: 'fault',
    source,
    status,
    code: 'INVALID_OUTCOME',
    committed,
    retryable: false,
    message,
    issues,
  };
}

/** The Issues of a value read at a part of the answer; none when it was read. */
export function issuesAt(part: Issue['part'], parsed: Parsed): readonly Issue[] {
  return parsed.kind === 'issues' ? parsed.issues.map((issue) => ({ part, ...issue })) : [];
}
