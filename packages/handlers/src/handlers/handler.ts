import type {
  ContextOf,
  Contract,
  DemandsOf,
  Endpoint,
  Guard,
  InputOf,
  QualifierOf,
  RequiredContextOf,
} from '@casitafeliz/loom-contract';
import type * as core from 'zod/v4/core';
import type { Admission, Outcome, ResolvedAdmission, ResolvedOutcome } from '../outcomes/index.ts';

/** What an EndpointHandler's implementation returns; may be async. */
export type EndpointImplementation<Target extends Endpoint> = (
  input: InputOf<Target>,
  context: ContextOf<Target>,
) => Outcome<Target> | Promise<Outcome<Target>>;

/** What a GuardHandler's implementation returns; may be async. */
export type GuardImplementation<Target extends Guard> = (
  demands: DemandsOf<Target>,
  context: RequiredContextOf<Target>,
  qualifier: QualifierOf<Target>,
) => Admission<Target> | Promise<Admission<Target>>;

/** The root a direct call resolves Standard Rejections against, as `serve` does. */
export type DirectCall = { readonly contract: Contract };

/** The Handler of one Endpoint: calling it runs the Contract's checks and answers what `serve` would. */
export type EndpointHandler<Target extends Endpoint> = {
  (
    input: InputOf<Target>,
    context: ContextOf<Target>,
    call?: DirectCall,
  ): Promise<ResolvedOutcome<Target>>;
  readonly element: Target;
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
