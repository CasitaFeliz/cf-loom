import type * as core from 'zod/v4/core';
import type { Endpoint } from './endpoint.ts';
import type { Guard } from './guard.ts';
import type { StandardRejection } from './standard-rejections.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : never;

type NoParts = Record<never, never>;

/** The Input an EndpointHandler receives: one key per declared part, typed by its schema. */
export type InputOf<Target extends Endpoint> = Target extends { readonly input: infer Input }
  ? { readonly [Part in keyof Input]-?: Output<Input[Part]> }
  : NoParts;

type GuardContext<Target> = Target extends { readonly context: infer Context }
  ? Output<Context>
  : undefined;

type GuardsOf<Target> = Target extends { readonly guards: readonly (infer Attached)[] }
  ? Attached
  : never;

type EndpointContext<Target extends Endpoint> = {
  readonly [Attached in GuardsOf<Target> as Attached extends Guard
    ? Attached['name']
    : never]: GuardContext<Attached>;
};

/** A Guard's Context, as its GuardHandler admits it; an Endpoint's, one key per attached Guard by name. */
export type ContextOf<Target extends Endpoint | Guard> = Target extends Guard
  ? GuardContext<Target>
  : Target extends Endpoint
    ? EndpointContext<Target>
    : never;

type ListedRejections<Target> = Target extends {
  readonly rejections: readonly (infer Listed)[];
}
  ? Listed
  : never;

/** Every Rejection an Endpoint may answer: its own, its Guards', and the two cf-loom's runtime adds. */
export type RejectionsOf<Target extends Endpoint> =
  | ListedRejections<Target>
  | ListedRejections<GuardsOf<Target>>
  | StandardRejection<'invalidInput'>
  | StandardRejection<'notImplemented'>;

/** The Success an EndpointHandler returns and a Caller receives: its status, and its headers and body typed. */
export type SuccessOf<Target extends Endpoint> = {
  readonly [Part in keyof Target['success']]: Part extends 'status'
    ? Target['success'][Part]
    : Output<Target['success'][Part]>;
};
