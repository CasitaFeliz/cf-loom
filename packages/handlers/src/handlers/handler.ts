import type {
  Command,
  ContextOf,
  DemandsOf,
  Endpoint,
  Guard,
  InputOf,
  QualifierOf,
  RequiredContextOf,
  Subscription,
} from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { HandledRequest } from '../checks/index.ts';
import type { Admission, CheckedAdmission, CheckedOutcome, Outcome } from '../outcomes/index.ts';
import type { Readers } from './reader.ts';
import type {
  CallArgument,
  NoResources,
  ResourcesField,
  ResourcesNotAnnotated,
} from './resources.ts';

declare const handled: unique symbol;

/** What only a Handler `handle()` returned for one Element carries: its Element, and a brand no hand-made value has. */
export type HandledBy<Element> = { readonly element: Element; readonly [handled]: Element };

/** What an EndpointHandler is given beside its Input: the Context its Guards provided, and the request. */
export type EndpointCall<Target extends Endpoint> = {
  readonly context: ContextOf<Target>;
  readonly request: HandledRequest;
};

/** `qualifier`, only when the Guard declares one. */
type QualifierField<Target extends Guard> = Target extends { readonly qualifier: core.$ZodType }
  ? { readonly qualifier: QualifierOf<Target> }
  : unknown;

/**
 * What a GuardHandler is given beside its demands: the Context of the Guards it lists, its
 * Qualifier when its Guard declares one, and the request.
 */
export type GuardCall<Target extends Guard> = {
  readonly context: RequiredContextOf<Target>;
  readonly request: HandledRequest;
} & QualifierField<Target>;

/** `context` in a direct call, optional exactly when no Guard gives the Handler a Context. */
type ContextField<Context> = keyof Context extends never
  ? { readonly context?: Context }
  : { readonly context: Context };

/** `request` in a direct call: each field left out is a signal never aborted, or empty headers. */
type DirectRequestField = { readonly request?: Partial<HandledRequest> };

/** What an EndpointHandler's implementation returns, given the Input, the Context and request, and the Resources it takes; may be async. */
export type EndpointImplementation<
  Target extends Endpoint,
  Resources extends object = ResourcesNotAnnotated,
> = (
  input: InputOf<Target>,
  call: EndpointCall<Target>,
  last: ResourcesField<Resources>,
) => Outcome<Target> | Promise<Outcome<Target>>;

/** What a GuardHandler's implementation returns, given its demands, its Context, Qualifier and request, and the Resources it takes; may be async. */
export type GuardImplementation<
  Target extends Guard,
  Resources extends object = ResourcesNotAnnotated,
> = (
  demands: DemandsOf<Target>,
  call: GuardCall<Target>,
  last: ResourcesField<Resources>,
) => Admission<Target> | Promise<Admission<Target>>;

/** The Handler of one Endpoint: calling it runs the Contract's checks and answers what `serve` would. */
export type EndpointHandler<Target extends Endpoint, Resources extends object = NoResources> = ((
  input: InputOf<Target>,
  call: ContextField<ContextOf<Target>> & DirectRequestField,
  ...last: CallArgument<ResourcesField<Resources>>
) => Promise<CheckedOutcome<Target>>) &
  HandledBy<Target>;

/**
 * The shape every Handler map has, which `serve` and `consume` accept: each Handler by its name,
 * known by the Endpoint, Guard, Command or Subscription it was written for, since its call
 * signature is the Service's own; the `readers` pairing each Command's Message Version and
 * Subscription with the Reader its Handler reads with, which `consume` reads with; and each
 * Deprecated Endpoint's `deprecatedAt`, from the Snapshot.
 */
export type HandlerMap = {
  readonly endpoints: Readonly<Record<string, { readonly element: Endpoint }>>;
  readonly guards: Readonly<Record<string, { readonly element: Guard }>>;
  readonly commands: Readonly<Record<string, { readonly element: Command }>>;
  readonly subscriptions: Readonly<Record<string, { readonly element: Subscription }>>;
  readonly readers: Readers;
  readonly deprecatedAt: Readonly<Record<string, string>>;
};

/** The Handler of one Guard: calling it validates what it is given and answers what `serve` would. */
export type GuardHandler<Target extends Guard, Resources extends object = NoResources> = ((
  demands: DemandsOf<Target>,
  call: ContextField<RequiredContextOf<Target>> & QualifierField<Target> & DirectRequestField,
  ...last: CallArgument<ResourcesField<Resources>>
) => Promise<CheckedAdmission<Target>>) &
  HandledBy<Target>;
