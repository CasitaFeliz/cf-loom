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
  LastNotAnnotated,
  NoResources,
  ResourcesField,
  ResourcesLast,
  TakesResources,
} from './resources.ts';

declare const handled: unique symbol;

/** What only a Handler `handle()` returned for one declaration carries: the declaration it was written for, the Resources it takes, and a brand no hand-made value has; `Resources` left out is `never`, unspecified, which `ResourcesOf` refuses and no Handler that takes some fits. */
export type HandledBy<Declaration, Resources = never> = {
  readonly declaration: Declaration;
  readonly [handled]: Declaration;
} & TakesResources<Resources>;

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

/** What an EndpointHandler's implementation returns, given the Input, the Context and request, and last the Resources it takes, `Needs<'orders'>`; may be async. */
export type EndpointImplementation<
  Target extends Endpoint,
  Last extends ResourcesLast<Last> = LastNotAnnotated,
> = (
  input: InputOf<Target>,
  call: EndpointCall<Target>,
  last: Last,
) => Outcome<Target> | Promise<Outcome<Target>>;

/** What a GuardHandler's implementation returns, given its demands, its Context, Qualifier and request, and last the Resources it takes, `Needs<'callers'>`; may be async. */
export type GuardImplementation<
  Target extends Guard,
  Last extends ResourcesLast<Last> = LastNotAnnotated,
> = (
  demands: DemandsOf<Target>,
  call: GuardCall<Target>,
  last: Last,
) => Admission<Target> | Promise<Admission<Target>>;

/** The Handler of one Endpoint: calling it runs the Contract's checks and answers what `serve` would. */
export type EndpointHandler<Target extends Endpoint, Resources extends object = NoResources> = ((
  input: InputOf<Target>,
  call: ContextField<ContextOf<Target>> & DirectRequestField,
  ...last: CallArgument<ResourcesField<Resources>>
) => Promise<CheckedOutcome<Target>>) &
  HandledBy<Target, Resources>;

/**
 * The runtime shape of every Handler map, which the startup checks of `serve` and `consume` read,
 * whatever the map's type: each Handler known by the declaration it was written for, and the
 * `readers`; `HandlerMapOf` is what they take by type.
 */
export type HandlerMap = {
  readonly endpoints: Readonly<Record<string, { readonly declaration: Endpoint }>>;
  readonly guards: Readonly<Record<string, { readonly declaration: Guard }>>;
  readonly commands: Readonly<Record<string, { readonly declaration: Command }>>;
  readonly subscriptions: Readonly<Record<string, { readonly declaration: Subscription }>>;
  readonly readers: Readers;
};

/** The Handler of one Guard: calling it validates what it is given and answers what `serve` would. */
export type GuardHandler<Target extends Guard, Resources extends object = NoResources> = ((
  demands: DemandsOf<Target>,
  call: ContextField<RequiredContextOf<Target>> & QualifierField<Target> & DirectRequestField,
  ...last: CallArgument<ResourcesField<Resources>>
) => Promise<CheckedAdmission<Target>>) &
  HandledBy<Target, Resources>;
