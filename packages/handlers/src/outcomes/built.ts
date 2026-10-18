import type { Rejection, StandardRejection } from '@casitafeliz/loom-contract';
import type { AnswerableRejection } from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';

/** A Success as a Handler builds it, its value read by the Endpoint it answers. */
export type BuiltSuccess<Value> = { readonly kind: 'success'; readonly value: Value };

type RejectionWithBody = Rejection & { readonly body: core.$ZodType };

/** A Rejection a Handler answers without a body; invalid input is the runtime's alone. */
type RejectionWithoutBody =
  | (Rejection & { readonly body?: undefined })
  | StandardRejection<'notFound' | 'notImplemented'>;

/**
 * A Rejection as a Handler builds it: its declaration, and its body when it declares one; a
 * Rejection whose type leaves its body open may carry one.
 */
export type BuiltRejection<Answered extends AnswerableRejection> =
  Answered extends RejectionWithBody
    ? {
        readonly kind: 'rejection';
        readonly rejection: Answered;
        readonly body: core.output<Answered['body']>;
      }
    : Answered extends RejectionWithoutBody
      ? { readonly kind: 'rejection'; readonly rejection: Answered }
      : { readonly kind: 'rejection'; readonly rejection: Answered; readonly body?: unknown };

/** Any Rejection a Handler builds, before the Endpoint or Guard it answers for checks it. */
export type AnyRejection = {
  readonly kind: 'rejection';
  readonly rejection: AnswerableRejection;
  readonly body?: unknown;
};

/** What a GuardHandler builds when the request passes: the Context its Guard provides. */
export type BuiltAdmitted<Context> = { readonly kind: 'admitted'; readonly context: Context };

/** The Success a Handler answers: nothing for 204, the body, or `{ headers, body }` with headers. */
export function success(): BuiltSuccess<undefined>;
export function success<Value>(value: Value): BuiltSuccess<Value>;
export function success(value?: unknown): BuiltSuccess<unknown> {
  return { kind: 'success', value };
}

/** The Rejection a Handler answers, by its declaration, with its body when it declares one. */
export function reject<Answered extends RejectionWithBody>(
  rejection: Answered,
  body: core.output<Answered['body']>,
): BuiltRejection<Answered>;
export function reject<Answered extends RejectionWithoutBody>(
  rejection: Answered,
): BuiltRejection<Answered>;
export function reject(rejection: AnswerableRejection, ...body: readonly unknown[]): AnyRejection {
  if (body.length === 0) {
    return { kind: 'rejection', rejection };
  }
  return { kind: 'rejection', rejection, body: body[0] };
}

/** What a GuardHandler answers when the request passes: the Context its Guard provides. */
export function admit(): BuiltAdmitted<undefined>;
export function admit<Context>(context: Context): BuiltAdmitted<Context>;
export function admit(context?: unknown): BuiltAdmitted<unknown> {
  return { kind: 'admitted', context };
}
