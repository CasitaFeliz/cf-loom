import type { ReceivedFault, ReceivedRejection } from '@cf-loom/client';
import type { AnyDependency, ListedEndpoint, ListedName } from '@cf-loom/client/internal';
import { type GivenShapeOf, internalError, type SuccessValueOf } from '@cf-loom/contract/internal';
import { type ScriptedAnswer, scriptedAnswerOf } from './answers.ts';

/**
 * What `r.success` takes: what a Success of the Endpoint is built from, as a Caller reads it; nothing
 * where it declares neither headers nor a body.
 */
type SuccessArguments<D extends AnyDependency, Name extends ListedName<D>> =
  SuccessValueOf<ListedEndpoint<D, Name>> extends infer Value
    ? [Value] extends [undefined]
      ? []
      : [success: Value]
    : never;

/**
 * What `r.reject` takes: each code the Endpoint answers paired with what that code declares, its
 * body, or `{ headers, body }` when it declares headers, so a code not narrowed to one is refused.
 */
type RejectionArguments<D extends AnyDependency, Name extends ListedName<D>> =
  ReceivedRejection<D, Name> extends infer Received
    ? Received extends { readonly code: infer Code }
      ? [code: Code, ...GivenArgumentsOf<GivenShapeOf<Received>>]
      : never
    : never;

/** What follows the code: nothing where the code declares neither side, optional where it admits `undefined`. */
type GivenArgumentsOf<Value> = [Value] extends [undefined]
  ? []
  : undefined extends Value
    ? [given?: Value]
    : [given: Value];

/**
 * What `r.unknownRejection` takes beside its code: the message its Envelope carries, and its
 * headers and body, none unless given; headers only for a code the Provider's Contract declares.
 */
type UnknownRejectionOptions = {
  readonly message?: string;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
};

/** What `r.fault` takes: a Fault as the Provider sends it, or a reserved code alone. */
export type ScriptedFault =
  | {
      readonly committed: ReceivedFault['committed'];
      readonly retryable: boolean;
      readonly message?: string;
    }
  | { readonly code: NonNullable<ReceivedFault['code']> };

/**
 * What a step builds its answer with, typed by what a Caller of the Endpoint `Name` receives
 * (`ReceivedOutcome<D, Name>`): a Success, a Rejection, a Fault, or what the client infers its
 * Fault from, a network failure or a status.
 */
export type StepBuilder<D extends AnyDependency, Name extends ListedName<D>> = {
  success(...success: SuccessArguments<D, Name>): ScriptedAnswer;
  /** A code the Endpoint answers, with its body when it declares one, or `{ headers, body }` when it declares headers. */
  reject(...rejection: RejectionArguments<D, Name>): ScriptedAnswer;
  /** A code the Endpoint does not answer, as a later Provider might send it. */
  unknownRejection(code: string, options?: UnknownRejectionOptions): ScriptedAnswer;
  fault(fault: ScriptedFault): ScriptedAnswer;
  noConnection(): ScriptedAnswer;
  reset(): ScriptedAnswer;
  status(status: number, headers?: Readonly<Record<string, string>>): ScriptedAnswer;
};

/** The one builder every step receives; its Endpoint's types are laid over it where it is given. */
export const stepBuilder = {
  success: (success?: unknown) => scriptedAnswerOf({ kind: 'success', success }),
  reject: (code: string, given?: unknown) => scriptedAnswerOf({ kind: 'rejection', code, given }),
  unknownRejection: (code: string, options: UnknownRejectionOptions = {}) =>
    scriptedAnswerOf({ ...options, kind: 'unknown-rejection', code }),
  fault: (fault: ScriptedFault) => {
    if ('code' in fault) {
      return scriptedAnswerOf({ kind: 'reserved', code: fault.code });
    }
    const { committed, retryable, message = internalError } = fault;
    return scriptedAnswerOf({ kind: 'fault', committed, retryable, message });
  },
  noConnection: () => scriptedAnswerOf({ kind: 'no-connection' }),
  reset: () => scriptedAnswerOf({ kind: 'reset' }),
  status: (status: number, headers: Readonly<Record<string, string>> = {}) =>
    scriptedAnswerOf({ kind: 'status', status, headers }),
};
