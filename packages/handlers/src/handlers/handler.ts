import type {
  Command,
  ContextOf,
  Contract,
  DemandsOf,
  Endpoint,
  Guard,
  InputOf,
  QualifierOf,
  RequiredContextOf,
  Subscription,
} from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { Admission, Outcome, ResolvedAdmission, ResolvedOutcome } from '../outcomes/index.ts';
import type { CallArgument, NoResources, ResourcesField, WithResources } from './resources.ts';

/** What an EndpointHandler's implementation returns, given the Input, the Context and the Resources it takes; may be async. */
export type EndpointImplementation<
  Target extends Endpoint,
  Resources extends object = NoResources,
> = (
  input: InputOf<Target>,
  context: ContextOf<Target>,
  call: WithResources<Resources>,
) => Outcome<Target> | Promise<Outcome<Target>>;

/** `qualifier`, only when the Guard declares one. */
type QualifierField<Target extends Guard> = Target extends { readonly qualifier: core.$ZodType }
  ? { readonly qualifier: QualifierOf<Target> }
  : unknown;

/** A GuardHandler's last argument, to its implementation and its direct call: its Qualifier, when its Guard declares one, and the Resources it takes. */
export type GuardCall<
  Target extends Guard,
  Resources extends object = NoResources,
> = QualifierField<Target> & ResourcesField<Resources>;

/** What a GuardHandler's implementation returns, given its demands, the Context of the Guards it lists, and its Qualifier and Resources; may be async. */
export type GuardImplementation<Target extends Guard, Resources extends object = NoResources> = (
  demands: DemandsOf<Target>,
  context: RequiredContextOf<Target>,
  call: GuardCall<Target, Resources>,
) => Admission<Target> | Promise<Admission<Target>>;

/** The last argument of an EndpointHandler's direct call: the root to resolve Standard Rejections against, as `serve` does, and the Resources the Handler takes. */
export type DirectCall<Resources extends object = NoResources> = {
  readonly contract?: Contract;
} & ResourcesField<Resources>;

/** The Handler of one Endpoint: calling it runs the Contract's checks and answers what `serve` would. */
export type EndpointHandler<Target extends Endpoint, Resources extends object = NoResources> = {
  (
    input: InputOf<Target>,
    context: ContextOf<Target>,
    ...call: CallArgument<DirectCall<Resources>>
  ): Promise<ResolvedOutcome<Target>>;
  readonly element: Target;
};

/**
 * The Handler map `handlers.generated.ts` exports, as `serve` and `consume` take it: each Handler
 * by its name, known by the Endpoint, Guard, Command or Subscription it was written for, since its
 * call signature is the Service's own; and each Deprecated Endpoint's `deprecatedAt`, from the
 * Snapshot.
 */
export type HandlerMap = {
  readonly endpoints: Readonly<Record<string, { readonly element: Endpoint }>>;
  readonly guards: Readonly<Record<string, { readonly element: Guard }>>;
  readonly commands: Readonly<Record<string, { readonly element: Command }>>;
  readonly subscriptions: Readonly<Record<string, { readonly element: Subscription }>>;
  readonly deprecatedAt: Readonly<Record<string, string>>;
};

/** The Handler of one Guard: calling it validates what it is given and answers what `serve` would. */
export type GuardHandler<Target extends Guard, Resources extends object = NoResources> = {
  (
    demands: DemandsOf<Target>,
    context: RequiredContextOf<Target>,
    ...call: CallArgument<GuardCall<Target, Resources>>
  ): Promise<ResolvedAdmission<Target>>;
  readonly element: Target;
};
