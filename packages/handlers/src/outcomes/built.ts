import type { Rejection, StandardRejection } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  type ReceivedShapeOf,
  type RejectionValueOf,
  rejectionShapeOf,
  shapeFieldsOf,
} from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';

/** A Success as a Handler builds it, its value read by the Endpoint it answers. */
export type BuiltSuccess<Value> = { readonly kind: 'success'; readonly value: Value };

/** A Rejection that declares headers, a body or both. */
type RejectionWithShape = Rejection &
  ({ readonly headers: core.$ZodObject } | { readonly body: core.$ZodType });

/** A Rejection a Handler answers without headers or a body; invalid input is the runtime's alone. */
type RejectionWithoutShape =
  | (Rejection & { readonly headers?: undefined; readonly body?: undefined })
  | StandardRejection<'notFound' | 'notImplemented'>;

/**
 * A Rejection as a Handler builds it: its declaration, and its headers and body where it declares
 * them; a Rejection whose type leaves them open may carry them.
 */
export type BuiltRejection<Answered extends AnswerableRejection> =
  Answered extends RejectionWithShape
    ? { readonly kind: 'rejection'; readonly rejection: Answered } & ReceivedShapeOf<Answered>
    : Answered extends RejectionWithoutShape
      ? { readonly kind: 'rejection'; readonly rejection: Answered }
      : {
          readonly kind: 'rejection';
          readonly rejection: Answered;
          readonly headers?: Readonly<Record<string, unknown>>;
          readonly body?: unknown;
        };

/** Any Rejection a Handler builds, before the Endpoint or Guard it answers for checks it. */
export type AnyRejection = {
  readonly kind: 'rejection';
  readonly rejection: AnswerableRejection;
  readonly headers?: unknown;
  readonly body?: unknown;
};

/** What a GuardHandler builds when it admits the request: the Context its Guard provides. */
export type BuiltAdmitted<Context> = { readonly kind: 'admitted'; readonly context: Context };

/** The Success a Handler answers: nothing for 204, the body, or `{ headers, body }` with headers. */
export function success(): BuiltSuccess<undefined>;
export function success<Value>(value: Value): BuiltSuccess<Value>;
export function success(value?: unknown): BuiltSuccess<unknown> {
  return { kind: 'success', value };
}

/**
 * The Rejection a Handler answers, by its declaration: its body when it declares one, or
 * `{ headers, body }` when it declares headers.
 */
export function reject<Answered extends RejectionWithShape>(
  rejection: Answered,
  given: RejectionValueOf<Answered>,
): BuiltRejection<Answered>;
export function reject<Answered extends RejectionWithoutShape>(
  rejection: Answered,
): BuiltRejection<Answered>;
export function reject(rejection: AnswerableRejection, ...given: readonly unknown[]): AnyRejection {
  if (given.length === 0) {
    return { kind: 'rejection', rejection };
  }
  const { headers, body } = shapeFieldsOf(rejectionShapeOf(rejection), given[0]);
  return { kind: 'rejection', rejection, headers, body };
}

/** What a GuardHandler answers when it admits the request: the Context its Guard provides. */
export function admit(): BuiltAdmitted<undefined>;
export function admit<Context>(context: Context): BuiltAdmitted<Context>;
export function admit(context?: unknown): BuiltAdmitted<unknown> {
  return { kind: 'admitted', context };
}
