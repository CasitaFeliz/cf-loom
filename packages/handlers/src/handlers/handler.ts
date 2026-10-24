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

/** What a GuardHandler's implementation returns; may be async. */
export type GuardImplementation<Target extends Guard> = (
  demands: DemandsOf<Target>,
  context: RequiredContextOf<Target>,
  qualifier: QualifierOf<Target>,
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

/** The Qualifier a GuardHandler's direct call takes third, only when its Guard declares one. */
type QualifierArgument<Target extends Guard> = Target extends {
  readonly qualifier: core.$ZodType;
}
  ? [qualifier: QualifierOf<Target>]
  : [];

/** The Handler of one Guard: calling it validates what it is given and answers what `serve` would. */
export type GuardHandler<Target extends Guard> = {
  (
    demands: DemandsOf<Target>,
    context: RequiredContextOf<Target>,
    ...qualifier: QualifierArgument<Target>
  ): Promise<ResolvedAdmission<Target>>;
  readonly element: Target;
};
