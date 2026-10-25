import type { ReceivedFault, ReceivedRejection, ReceivedSuccess } from '@cf-loom/client';
import type { AnyDependency, ListedName } from '@cf-loom/client/internal';
import { internalError } from '@cf-loom/contract/internal';
import { type ScriptedAnswer, scriptedAnswerOf } from './answers.ts';

/** The Success a Caller of the Endpoint `Name` receives, as a step scripts it: its parts, never its kind or status. */
type ScriptedSuccess<D extends AnyDependency, Name extends ListedName<D>> = Omit<
  ReceivedSuccess<D, Name>,
  'kind' | 'status'
>;

/** What `r.success` takes: the body, or its headers and body when the Endpoint declares headers. */
type SuccessArguments<D extends AnyDependency, Name extends ListedName<D>> =
  ReceivedSuccess<D, Name> extends { readonly headers: unknown }
    ? [success: ScriptedSuccess<D, Name>]
    : ReceivedSuccess<D, Name> extends { readonly body: infer Body }
      ? [body: Body]
      : [];

/** A code the Endpoint answers, a Standard one by the Provider's code. */
type KnownCodeOf<D extends AnyDependency, Name extends ListedName<D>> = ReceivedRejection<
  D,
  Name
>['code'];

/** Marks a code that declares no body, apart from any body type. */
declare const noBody: unique symbol;

type NoBody = typeof noBody;

/** The body each code of `Code` declares, or `NoBody` for one that declares none. */
type DeclaredBodyOf<
  D extends AnyDependency,
  Name extends ListedName<D>,
  Code,
> = Code extends unknown
  ? Extract<ReceivedRejection<D, Name>, { readonly code: Code }> extends {
      readonly body: infer Body;
    }
    ? Body
    : NoBody
  : never;

/** What `r.reject` takes after a code: its body when the code, or any code it may be, declares one. */
type RejectionBodyArguments<
  D extends AnyDependency,
  Name extends ListedName<D>,
  Code,
> = BodyArgumentsOf<Exclude<DeclaredBodyOf<D, Name, Code>, NoBody>>;

type BodyArgumentsOf<Body> = [Body] extends [never]
  ? []
  : undefined extends Body
    ? [body?: Body]
    : [body: Body];

/** What `r.unknownRejection` takes beside its code: the message its Envelope carries, and a body, none unless given. */
type UnknownRejectionOptions = { readonly message?: string; readonly body?: unknown };

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
  /** A code the Endpoint answers, with its body when it declares one. */
  reject<Code extends KnownCodeOf<D, Name>>(
    code: Code,
    ...body: RejectionBodyArguments<D, Name, NoInfer<Code>>
  ): ScriptedAnswer;
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
  reject: (code: string, body?: unknown) => scriptedAnswerOf({ kind: 'rejection', code, body }),
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
