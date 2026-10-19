import type {
  Dependencies,
  Endpoint,
  RejectionsOf,
  StandardRejections,
} from '@casitafeliz/loom-contract';
import type { ReceivedInvalidInputBody } from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';
import type { ReceivedFault } from '../inference/index.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : undefined;

/** Any Dependency, whatever it selects and whatever Standard codes its Provider resolved. */
export type AnyDependencies = Dependencies<
  Readonly<Record<string, Endpoint>>,
  unknown,
  StandardRejections
>;

/** A Success as a Caller receives it: its body as `value` and its declared headers, both read. */
export type ReceivedSuccess<Target extends Endpoint> = {
  readonly kind: 'success';
  readonly value: Target['success'] extends { readonly body: infer Body }
    ? Output<Body>
    : undefined;
  readonly headers: Target['success'] extends { readonly headers: infer Headers }
    ? Output<Headers>
    : Readonly<Record<never, never>>;
};

/** A Rejection whose code the Caller knows, so checking `known` narrows by `code`. */
type KnownRejection<Code, Body> = {
  readonly kind: 'rejection';
  readonly known: true;
  readonly code: Code;
  readonly message: string;
  readonly body: Body;
};

/** A Rejection with a code the Caller does not know: codes are open, its body unvalidated. */
type UnknownRejection = {
  readonly kind: 'rejection';
  readonly known: false;
  readonly code: string;
  readonly message: string;
  readonly body: unknown;
};

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
export type ReceivedRejection<
  Target extends Endpoint,
  Standards extends StandardRejections = StandardRejections,
> = KnownRejectionOf<RejectionsOf<Target>, Standards> | UnknownRejection;

/** The Outcome a Caller receives from one Endpoint: exactly one of a Success, a Rejection or a Fault. */
export type ReceivedOutcome<
  Target extends Endpoint,
  Standards extends StandardRejections = StandardRejections,
> = ReceivedSuccess<Target> | ReceivedRejection<Target, Standards> | ReceivedFault;
