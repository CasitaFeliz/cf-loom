import type { Rejection, StandardRejection } from '@cf-loom/contract';
import { type AnswerableRejection, rejectionFieldsOf } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';

/** A Success as a Handler builds it, its value read by the Endpoint it answers. */
export type BuiltSuccess<Value> = { readonly kind: 'success'; readonly value: Value };

type RejectionWithHeaders = Rejection & { readonly headers: core.$ZodObject };

type RejectionWithBody = Rejection & {
  readonly body: core.$ZodType;
  readonly headers?: undefined;
};

/** A Rejection a Handler answers without headers or a body; invalid input is the runtime's alone. */
type RejectionWithoutBody =
  | (Rejection & { readonly body?: undefined; readonly headers?: undefined })
  | StandardRejection<'notFound' | 'notImplemented'>;

/** What a Rejection that declares headers is built from: its headers, and its body when it declares one. */
type HeadersGiven<Answered extends RejectionWithHeaders> = {
  readonly headers: core.output<Answered['headers']>;
} & BodyGiven<Answered>;

type BodyGiven<Answered extends Rejection> = Answered extends { readonly body: core.$ZodType }
  ? { readonly body: core.output<Answered['body']> }
  : { readonly body?: never };

/**
 * A Rejection as a Handler builds it: its declaration, its headers and its body when it declares
 * them; a Rejection whose type leaves its headers or body open may carry them.
 */
export type BuiltRejection<Answered extends AnswerableRejection> =
  Answered extends RejectionWithHeaders
    ? {
        readonly kind: 'rejection';
        readonly rejection: Answered;
        readonly headers: core.output<Answered['headers']>;
      } & BuiltBody<Answered>
    : Answered extends RejectionWithBody
      ? {
          readonly kind: 'rejection';
          readonly rejection: Answered;
          readonly body: core.output<Answered['body']>;
        }
      : Answered extends RejectionWithoutBody
        ? { readonly kind: 'rejection'; readonly rejection: Answered }
        : {
            readonly kind: 'rejection';
            readonly rejection: Answered;
            readonly headers?: unknown;
            readonly body?: unknown;
          };

type BuiltBody<Answered extends Rejection> = Answered extends { readonly body: core.$ZodType }
  ? { readonly body: core.output<Answered['body']> }
  : unknown;

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
export function reject<Answered extends RejectionWithHeaders>(
  rejection: Answered,
  given: HeadersGiven<Answered>,
): BuiltRejection<Answered>;
export function reject<Answered extends RejectionWithBody>(
  rejection: Answered,
  body: core.output<Answered['body']>,
): BuiltRejection<Answered>;
export function reject<Answered extends RejectionWithoutBody>(
  rejection: Answered,
): BuiltRejection<Answered>;
export function reject(rejection: AnswerableRejection, ...given: readonly unknown[]): AnyRejection {
  if (given.length === 0) {
    return { kind: 'rejection', rejection };
  }
  const { headers, body } = rejectionFieldsOf(rejection, given[0]);
  return {
    kind: 'rejection',
    rejection,
    ...(headers === undefined ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
  };
}

/** What a GuardHandler answers when it admits the request: the Context its Guard provides. */
export function admit(): BuiltAdmitted<undefined>;
export function admit<Context>(context: Context): BuiltAdmitted<Context>;
export function admit(context?: unknown): BuiltAdmitted<unknown> {
  return { kind: 'admitted', context };
}
