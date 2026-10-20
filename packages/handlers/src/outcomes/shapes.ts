import { committedValues } from '@cf-loom/contract/internal';
import type { AnyRejection, BuiltAdmitted, BuiltSuccess } from './built.ts';
import type { Fault } from './fault.ts';

/** What any EndpointHandler builds, before its Endpoint checks it. */
export type AnyOutcome = BuiltSuccess<unknown> | AnyRejection | Fault;

/** What any GuardHandler builds, before its Guard checks it. */
export type AnyAdmission = BuiltAdmitted<unknown> | AnyRejection | Fault;

/** The kinds an EndpointHandler builds, as values, so what it returns is told by its kind. */
export const outcomeKinds = [
  'success',
  'rejection',
  'fault',
] as const satisfies readonly AnyOutcome['kind'][];

/** The kinds a GuardHandler builds, as values, so what it returns is told by its kind. */
export const admissionKinds = [
  'admitted',
  'rejection',
  'fault',
] as const satisfies readonly AnyAdmission['kind'][];

type BuiltKind = AnyOutcome['kind'] | AnyAdmission['kind'];

/** Whether an EndpointHandler returned an Outcome: one of its kinds, with that kind's fields. */
export function isOutcome(value: unknown): value is AnyOutcome {
  return isBuiltOf(value, outcomeKinds);
}

/** Whether a GuardHandler returned an Admission: one of its kinds, with that kind's fields. */
export function isAdmission(value: unknown): value is AnyAdmission {
  return isBuiltOf(value, admissionKinds);
}

function isBuiltOf(value: unknown, kinds: readonly BuiltKind[]): boolean {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false;
  }
  const builtKinds: readonly unknown[] = kinds;
  return builtKinds.includes(value.kind) && hasFieldsOf(value as { readonly kind: BuiltKind });
}

function hasFieldsOf(value: { readonly kind: BuiltKind }): boolean {
  switch (value.kind) {
    case 'success':
      return 'value' in value;
    case 'admitted':
      return 'context' in value;
    case 'rejection':
      return 'rejection' in value;
    case 'fault':
      return isFault(value);
  }
}

/** Whether a value is a Fault: its kind with a valid `committed`, `retryable` and `message`. */
export function isFault(value: unknown): value is Fault {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const committed: readonly unknown[] = committedValues;
  return (
    'kind' in value &&
    value.kind === 'fault' &&
    'committed' in value &&
    committed.includes(value.committed) &&
    'retryable' in value &&
    typeof value.retryable === 'boolean' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
