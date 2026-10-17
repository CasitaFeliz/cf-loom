import type * as core from 'zod/v4/core';
import type { Endpoint } from './endpoint.ts';

type Output<Schema> = Schema extends core.$ZodType ? core.output<Schema> : never;

type NoParts = Record<never, never>;

/** The Input an EndpointHandler receives: one key per declared part, typed by its schema. */
export type InputOf<Target extends Endpoint> = Target extends { readonly input: infer Input }
  ? { readonly [Part in keyof Input]-?: Output<Input[Part]> }
  : NoParts;

/** The Success an EndpointHandler returns and a Caller receives: its status, and its headers and body typed. */
export type SuccessOf<Target extends Endpoint> = {
  readonly [Part in keyof Target['success']]: Part extends 'status'
    ? Target['success'][Part]
    : Output<Target['success'][Part]>;
};
