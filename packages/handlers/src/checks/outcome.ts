import type { Endpoint, Guard } from '@cf-loom/contract';
import {
  parsedPartOf,
  parsedShapeOf,
  schemaOf,
  shapeFieldsOf,
  successShapeOf,
} from '@cf-loom/contract/internal';
import {
  type AnyAdmission,
  type AnyOutcome,
  type BuiltSuccess,
  type CheckedAdmission,
  type CheckedOutcome,
  type Fault,
  retryAfterProblemOf,
} from '../outcomes/index.ts';
import { type Checked, mapValue } from './checked.ts';
import { checkedEndpointRejection, checkedGuardRejection } from './rejection.ts';

/**
 * What an EndpointHandler built, checked against its Endpoint, its Success as `serve` sends it:
 * parsed with its schema as written, so unknown keys are stripped: every object in a Read shape is
 * open.
 */
export function checkedOutcome(
  endpoint: Endpoint,
  built: AnyOutcome,
): Checked<CheckedOutcome<Endpoint>> {
  switch (built.kind) {
    case 'success':
      return checkedSuccess(endpoint, built);
    case 'rejection':
      return checkedEndpointRejection(endpoint, built);
    case 'fault':
      return checkedFault(built);
  }
}

/**
 * What a GuardHandler built, checked against its Guard: parsed with its schema as
 * written, so unknown keys are stripped.
 */
export function checkedAdmission(
  guard: Guard,
  built: AnyAdmission,
): Checked<CheckedAdmission<Guard>> {
  switch (built.kind) {
    case 'admitted': {
      const context = parsedPartOf('context', schemaOf(guard, 'context'), { value: built.context });
      return mapValue(context, (parsed) => ({ kind: 'admitted', context: parsed }));
    }
    case 'rejection':
      return checkedGuardRejection(guard, built);
    case 'fault':
      return checkedFault(built);
  }
}

/** A Fault a Handler built, sendable: its `retryAfter`, if any, one `Retry-After` can carry. */
function checkedFault(built: Fault): Checked<Fault> {
  const message = retryAfterProblemOf(built);
  if (message === undefined) {
    return { kind: 'value', value: built };
  }
  const issue = { part: 'fault', path: ['retryAfter'], code: 'invalid_value', message } as const;
  return { kind: 'issues', issues: [issue] };
}

/** The Success member of what a direct call returns. */
type CheckedSuccess = Extract<CheckedOutcome<Endpoint>, { readonly kind: 'success' }>;

/**
 * The value a Handler gave `success()`, read by its Endpoint's shape and sendable: the body, or
 * `{ headers, body }` when the Endpoint declares headers; only the parts it declares come back.
 */
function checkedSuccess(
  endpoint: Endpoint,
  { value }: BuiltSuccess<unknown>,
): Checked<CheckedOutcome<Endpoint>> {
  const shape = successShapeOf(endpoint);
  const parsed = parsedShapeOf(shape, shapeFieldsOf(shape, value));
  return mapValue(parsed, (parts) => {
    const success = { kind: 'success', status: endpoint.success.status, ...parts };
    return success as CheckedSuccess;
  });
}
