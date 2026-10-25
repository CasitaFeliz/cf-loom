import type { ReceivedFault } from '@cf-loom/client';
import type { EndpointRejection, EndpointSuccess } from '@cf-loom/client/internal';
import type { Endpoint, ProvidedStandardRejections } from '@cf-loom/contract';
import { internalError } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { type ScriptedAnswer, scriptedAnswerOf } from './answers.ts';

/** What `r.success` takes: the body, or its headers and body when the Endpoint declares headers. */
type SuccessArguments<Target extends Endpoint> = Target['success'] extends {
  readonly headers: core.$ZodType;
}
  ? [success: ScriptedHeadersAndBody<Target>]
  : Target['success'] extends { readonly body: core.$ZodType }
    ? [body: EndpointSuccess<Target>['body']]
    : [];

type ScriptedHeadersAndBody<Target extends Endpoint> = Target['success'] extends {
  readonly body: core.$ZodType;
}
  ? {
      readonly headers: EndpointSuccess<Target>['headers'];
      readonly body: EndpointSuccess<Target>['body'];
    }
  : { readonly headers: EndpointSuccess<Target>['headers'] };

/** What `r.reject` takes for a code the Endpoint answers: the code, and its body when it declares one. */
type KnownRejectionArguments<Known> = Known extends { readonly code: infer Code }
  ? Known extends { readonly body: infer Body }
    ? undefined extends Body
      ? [code: Code, body?: Body]
      : [code: Code, body: Body]
    : [code: Code]
  : never;

/** A code the Provider does not declare, with the message its Envelope carries, its code by default. */
export type UnknownCode = { readonly unknown: string; readonly message?: string };

/** What `r.fault` takes: a Fault as the Provider sends it, or a reserved code alone. */
export type ScriptedFault =
  | {
      readonly committed: ReceivedFault['committed'];
      readonly retryable: boolean;
      readonly message?: string;
    }
  | { readonly code: NonNullable<ReceivedFault['code']> };

/**
 * What a step builds its answer with, typed by its Endpoint and the Provider's Standard Rejections,
 * which type the invalid-input body by its Reader, as a Caller reads each Outcome: a Success, a
 * Rejection, a Fault, or what the client infers its Fault from, a network failure or a status.
 */
export type StepBuilder<Target extends Endpoint, Standards extends ProvidedStandardRejections> = {
  success(...success: SuccessArguments<Target>): ScriptedAnswer;
  reject(
    ...rejection:
      | KnownRejectionArguments<EndpointRejection<Target, Standards>>
      | [unknown: UnknownCode, body: unknown]
  ): ScriptedAnswer;
  fault(fault: ScriptedFault): ScriptedAnswer;
  noConnection(): ScriptedAnswer;
  reset(): ScriptedAnswer;
  status(status: number, headers?: Readonly<Record<string, string>>): ScriptedAnswer;
};

/** The one builder every step receives; its Endpoint's types are laid over it where it is given. */
export const stepBuilder = {
  success: (success?: unknown) => scriptedAnswerOf({ kind: 'success', success }),
  reject: (code: string | UnknownCode, body?: unknown) => {
    if (typeof code === 'string') {
      return scriptedAnswerOf({ kind: 'rejection', code, body });
    }
    const message = code.message ?? code.unknown;
    return scriptedAnswerOf({ kind: 'unknown-rejection', code: code.unknown, message, body });
  },
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
