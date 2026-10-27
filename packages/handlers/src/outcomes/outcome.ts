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

/** What a GuardHandler builds: the request admitted with its Context, one of the Guard's Rejections, or a Fault. */
export type Admission<Target extends Guard> =
  | BuiltAdmitted<ProvidedContextOf<Target>>
  | BuiltRejection<RejectionsOf<Target>>
  | Fault;

/** What a direct call of a GuardHandler returns: the admitted Context, a Rejection as built with its body parsed, or a Fault. */
export type CheckedAdmission<Target extends Guard> =
  | BuiltAdmitted<ProvidedContextOf<Target>>
  | BuiltRejection<RejectionsOf<Target>>
  | Fault;
