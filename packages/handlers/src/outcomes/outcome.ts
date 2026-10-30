import type {
  Endpoint,
  Guard,
  ProvidedContextOf,
  RejectionsOf,
  StandardRejection,
  SuccessOf,
} from '@cf-loom/contract';
import type { SuccessValueOf } from '@cf-loom/contract/internal';
import type { BuiltAdmitted, BuiltRejection, BuiltSuccess } from './built.ts';
import type { Fault } from './fault.ts';

/** The Rejections a Handler of an Endpoint may build: all it answers but invalid input. */
type BuildableOf<Target extends Endpoint> = Exclude<
  RejectionsOf<Target>,
  StandardRejection<'invalidInput'>
>;

/** What an EndpointHandler builds: a Success, one of the Endpoint's Rejections with its body, or a Fault. */
export type Outcome<Target extends Endpoint> =
  | BuiltSuccess<SuccessValueOf<Target>>
  | BuiltRejection<BuildableOf<Target>>
  | Fault;

/** What a direct call of an EndpointHandler returns: the Success as `serve` sends it, a Rejection as built with its body parsed, or a Fault. */
export type CheckedOutcome<Target extends Endpoint> =
  | ({ readonly kind: 'success' } & SuccessOf<Target>)
  | BuiltRejection<BuildableOf<Target>>
  | Fault;

/**
 * What a GuardHandler answers: the request admitted with the Context its Guard provides, one of
 * the Guard's Rejections, or a Fault. Its implementation builds it; its direct call returns it
 * checked, the Context and a Rejection's headers and body parsed.
 */
export type Admission<Target extends Guard> =
  | BuiltAdmitted<ProvidedContextOf<Target>>
  | BuiltRejection<RejectionsOf<Target>>
  | Fault;
