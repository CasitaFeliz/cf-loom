import type * as core from 'zod/v4/core';
import type { AttachedGuardOf } from './attachment.ts';
import type { Endpoint } from './endpoint.ts';
import type { Guard, QualifiedGuard } from './guard.ts';
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

/** The Context one Guard provides, as its GuardHandler admits it; `undefined` without a context. */
export type ProvidedContextOf<Target extends Guard> = Target extends ContextProvider
  ? Output<Target['context']>
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

type ListedRejections<Target> = Target extends {
  readonly rejections: readonly (infer Listed)[];
}
  ? Listed
  : never;

/** Every Rejection an Endpoint may answer: its own, its Guards' and the two the runtime adds. */
type EndpointRejectionsOf<Target extends Endpoint> =
  | ListedRejections<Target>
  | ListedRejections<GuardsOf<Target>>
  | StandardRejection<AddedStandardRejectionName>;

/** Every Rejection a Guard may answer: its own and the not-implemented one its stub answers. */
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
  readonly [Part in keyof Target['success']]: Part extends 'status'
    ? Target['success'][Part]
    : Output<Target['success'][Part]>;
};
