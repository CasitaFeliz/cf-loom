export type { AnyRejection, BuiltAdmitted, BuiltRejection, BuiltSuccess } from './built.ts';
export { admit, reject, success } from './built.ts';
export type { Committed, Fault } from './fault.ts';
export { fault, thrownFault } from './fault.ts';
export type {
  Admission,
  Outcome,
  ResolvedAdmission,
  ResolvedOutcome,
  ResolvedRejection,
} from './outcome.ts';
export type { AnyAdmission, AnyOutcome } from './shapes.ts';
export { isAdmission, isOutcome } from './shapes.ts';
