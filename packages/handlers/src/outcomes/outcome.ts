import type {
  Endpoint,
  Guard,
  ProvidedContextOf,
  Rejection,
  RejectionsOf,
  StandardRejection,
  SuccessOf,
} from '@cf-loom/contract';
import type { AnswerableRejection } from '@cf-loom/contract/internal';
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

/** A declared Rejection's code, status and message as written; a Standard one's as the root resolves them. */
type ResolutionOf<Answered extends AnswerableRejection> = Answered extends Rejection
  ? {
      readonly code: Answered['code'];
      readonly status: Answered['status'];
      readonly message: Answered['message'];
    }
  : { readonly code: string; readonly status: number; readonly message: string };

/** A Rejection as a direct call returns it: as built, its code, status and message resolved. */
export type ResolvedRejection<Answered extends AnswerableRejection> = Answered extends unknown
  ? BuiltRejection<Answered> & ResolutionOf<Answered>
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
