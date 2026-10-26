import type * as core from 'zod/v4/core';
import type { AttachedGuardOf } from './attachment.ts';
import type { Endpoint } from './endpoint.ts';
import type { Guard, QualifiedGuard } from './guard.ts';
import type { Rejection } from './rejection.ts';
import type { AddedStandardRejectionName, StandardRejection } from './standard-rejections.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : never;

type NoParts = Record<never, never>;

/** The Input an EndpointHandler receives: one key per declared part, typed by its schema. */
export type InputOf<Target extends Endpoint> = Target extends { readonly input: infer Input }
  ? { readonly [Part in keyof Input]-?: Output<Input[Part]> }
  : NoParts;

type ContextProvider = Guard & { readonly context: core.$ZodType };

type GuardsOf<Target> = Target extends { readonly guards: readonly (infer Listed)[] }
  ? AttachedGuardOf<Listed>
  : never;

/**
 * The Context one Guard provides, as its GuardHandler admits it; `undefined` without a context,
 * and `unknown` for a Guard whose type leaves its context open.
 */
export type ProvidedContextOf<Target extends Guard> = Target extends ContextProvider
  ? Output<Target['context']>
  : 'context' extends keyof Target
    ? unknown
    : undefined;

/** The Qualifier a Guard's GuardHandler receives, typed by its schema; `undefined` without one. */
export type QualifierOf<Target extends Guard> = Target extends QualifiedGuard
  ? Output<Target['qualifier']>
  : undefined;

type ContextByName<Guards> = {
  readonly [Listed in Guards as Listed extends ContextProvider
    ? Listed['name']
    : never]: Listed extends Guard ? ProvidedContextOf<Listed> : never;
};

/** An Endpoint's Context: one key per attached Guard that provides a Context, by name. */
export type ContextOf<Target extends Endpoint> = ContextByName<GuardsOf<Target>>;

/** What a dependent Guard reads: one key per Guard it lists that provides a Context, by name. */
export type RequiredContextOf<Target extends Guard> = ContextByName<GuardsOf<Target>>;

/** What a list a declaration may leave out holds; nothing when its type has no such list. */
type ListedIn<Target, Field extends 'rejections' | 'guards'> = Target extends unknown
  ? Field extends keyof Target
    ? NonNullable<Target[Field]> extends readonly (infer Listed)[]
      ? Listed
      : never
    : never
  : never;

/** The Rejections a declaration lists, its type's lists left open or not. */
type ListedRejections<Target> = ListedIn<Target, 'rejections'>;

/** The Guards whose Rejections a declaration answers, its type's lists left open or not. */
type RejectingGuardsOf<Target> = AttachedGuardOf<ListedIn<Target, 'guards'>>;

/** Every Rejection an Endpoint may answer: its own, its Guards' and the two the runtime adds. */
type EndpointRejectionsOf<Target extends Endpoint> =
  | ListedRejections<Target>
  | ListedRejections<RejectingGuardsOf<Target>>
  | StandardRejection<AddedStandardRejectionName>;

/** Every Rejection a Guard may answer: its own and the not-implemented one its Stub answers. */
type GuardRejectionsOf<Target extends Guard> =
  | ListedRejections<Target>
  | StandardRejection<'notImplemented'>;

/** Every Rejection an Endpoint or a Guard may answer. */
export type RejectionsOf<Target extends Endpoint | Guard> = Target extends Endpoint
  ? EndpointRejectionsOf<Target>
  : Target extends Guard
    ? GuardRejectionsOf<Target>
    : never;

/** What a GuardHandler receives first: one key per declared demand part, typed by its schema. */
export type DemandsOf<Target extends Guard> = Target extends { readonly demands: infer Demands }
  ? { readonly [Part in keyof Demands]-?: Output<Demands[Part]> }
  : NoParts;

/** The Success an EndpointHandler returns and a Caller receives: its status, headers and body. */
export type SuccessOf<Target extends Endpoint> = {
  readonly [Part in keyof Target['success']]: Part extends keyof ReceivedShapeOf<Target['success']>
    ? ReceivedShapeOf<Target['success']>[Part]
    : Target['success'][Part];
};

/**
 * The headers and body a Success or a Rejection declares, as whoever reads them receives them:
 * one key per side it declares, typed by its schema.
 */
export type ReceivedShapeOf<Declared> = ReceivedSidesOf<
  Pick<Declared, keyof Declared & ('headers' | 'body')>
>;

type ReceivedSidesOf<Sides> = { readonly [Side in keyof Sides]: Output<Sides[Side]> };

/**
 * What a shape is built from by whoever writes one, given what a reader receives of it: the body,
 * `{ headers, body }` when it declares headers, or nothing; a body where it declares none is refused.
 */
export type GivenShapeOf<Received> = Received extends { readonly headers: infer Headers }
  ? Received extends { readonly body: infer Body }
    ? { readonly headers: Headers; readonly body: Body }
    : { readonly headers: Headers; readonly body?: never }
  : Received extends { readonly body: infer Body }
    ? Body
    : undefined;

/** What a Success is built from, by whoever writes one for an Endpoint. */
export type SuccessValueOf<Target extends Endpoint> = GivenShapeOf<
  ReceivedShapeOf<Target['success']>
>;

/** What a Rejection is built from, by whoever writes one. */
export type RejectionValueOf<Answered extends Rejection> = GivenShapeOf<ReceivedShapeOf<Answered>>;
