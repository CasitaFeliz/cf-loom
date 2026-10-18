import type {
  Endpoint,
  Guard,
  ProvidedContextOf,
  RejectionsOf,
  StandardRejection,
  SuccessOf,
} from '@casitafeliz/loom-contract';
import type { AnswerableRejection } from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';
import type { BuiltAdmitted, BuiltRejection, BuiltSuccess } from './built.ts';
import type { Fault } from './fault.ts';

/** The Rejections a Handler of an Endpoint may build: all it answers but invalid input. */
type BuildableOf<Target extends Endpoint> = Exclude<
  RejectionsOf<Target>,
  StandardRejection<'invalidInput'>
>;

/**
 * What `success()` is given: the body, `{ headers, body }` when headers are declared, or nothing;
 * a body where the Endpoint declares none is refused.
 */
type SuccessValueOf<Target extends Endpoint> = Target['success'] extends {
  readonly headers: core.$ZodType;
}
  ? Omit<SuccessOf<Target>, 'status'> & NoBodyOf<Target>
  : Target['success'] extends { readonly body: core.$ZodType }
    ? core.output<Target['success']['body']>
    : undefined;

type NoBodyOf<Target extends Endpoint> = Target['success'] extends { readonly body: core.$ZodType }
  ? unknown
  : { readonly body?: never };

/** A Rejection as a direct call returns it: as built, its code, status and message resolved. */
export type ResolvedRejection<Answered extends AnswerableRejection> = Answered extends unknown
  ? BuiltRejection<Answered> & {
      readonly code: string;
      readonly status: number;
      readonly message: string;
    }
  : never;

/** What an EndpointHandler builds: a Success, one of the Endpoint's Rejections with its body, or a Fault. */
export type Outcome<Target extends Endpoint> =
  | BuiltSuccess<SuccessValueOf<Target>>
  | BuiltRejection<BuildableOf<Target>>
  | Fault;

/** What a direct call of an EndpointHandler returns: the Outcome with its status, code and message resolved. */
export type ResolvedOutcome<Target extends Endpoint> =
  | ({ readonly kind: 'success' } & SuccessOf<Target>)
  | ResolvedRejection<BuildableOf<Target>>
  | Fault;

/** What a GuardHandler builds: the request admitted with its Context, one of the Guard's Rejections, or a Fault. */
export type Admission<Target extends Guard> =
  | BuiltAdmitted<ProvidedContextOf<Target>>
  | BuiltRejection<RejectionsOf<Target>>
  | Fault;

/** What a direct call of a GuardHandler returns: the Admission with its code, status and message resolved. */
export type ResolvedAdmission<Target extends Guard> =
  | BuiltAdmitted<ProvidedContextOf<Target>>
  | ResolvedRejection<RejectionsOf<Target>>
  | Fault;
