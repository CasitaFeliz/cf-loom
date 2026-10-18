import type * as core from 'zod/v4/core';
import type { Endpoint } from './endpoint.ts';
import type { Guard } from './guard.ts';
import type { AddedStandardRejection, StandardRejection } from './standard-rejections.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : never;

type NoParts = Record<never, never>;

/** The Input an EndpointHandler receives: one key per declared part, typed by its schema. */
export type InputOf<Target extends Endpoint> = Target extends { readonly input: infer Input }
  ? { readonly [Part in keyof Input]-?: Output<Input[Part]> }
  : NoParts;

type ContextProvider = Guard & { readonly context: core.$ZodType };

type GuardsOf<Target> = Target extends { readonly guards: readonly (infer Attached)[] }
  ? Attached
  : never;

/** The Context one Guard provides, as its GuardHandler admits it; `undefined` without a context. */
export type ProvidedContextOf<Target extends Guard> = Target extends ContextProvider
  ? Output<Target['context']>
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

/** Every Rejection an Endpoint may answer: its own, its Guards' and the two cf-loom's runtime adds. */
export type RejectionsOf<Target extends Endpoint> =
  | ListedRejections<Target>
  | ListedRejections<GuardsOf<Target>>
  | StandardRejection<AddedStandardRejection>;

/** The Success an EndpointHandler returns and a Caller receives: its status, headers and body. */
export type SuccessOf<Target extends Endpoint> = {
  readonly [Part in keyof Target['success']]: Part extends 'status'
    ? Target['success'][Part]
    : Output<Target['success'][Part]>;
};
