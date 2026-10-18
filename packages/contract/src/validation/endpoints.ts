import { lifecycles, visibilities } from '../element.ts';
import type { Endpoint } from '../endpoint.ts';
import { methods, successStatuses } from '../http.ts';
import type { LocatedEndpoint } from './declarations.ts';
import { type DeclarationFailure, failure, type Rule } from './failures.ts';
import { slotAt } from './schemas.ts';

/** A closed value a declaration takes, as the types state it, and the rule that judges it. */
type ClosedValue = {
  readonly field: keyof Endpoint;
  readonly rule: Rule;
  readonly allowed: readonly unknown[];
  readonly noun: string;
};

const closedValues: readonly ClosedValue[] = [
  { field: 'method', rule: 'method', allowed: methods, noun: 'A method' },
  { field: 'visibility', rule: 'visibility', allowed: visibilities, noun: 'A Visibility' },
  { field: 'lifecycle', rule: 'lifecycle', allowed: lifecycles, noun: 'A lifecycle' },
];

/** The rules of an Endpoint alone: its closed values, its Success's status and where a body belongs. */
export function endpointFailures(located: LocatedEndpoint): readonly DeclarationFailure[] {
  return [
    ...closedValues.flatMap((closed) => closedValueFailures(located, closed)),
    ...successFailures(located),
    ...inputBodyFailures(located),
  ];
}

/** A value present is one of the allowed; a value absent is the required-field rule's finding. */
function closedValueFailures(
  { at, endpoint }: LocatedEndpoint,
  { field, rule, allowed, noun }: ClosedValue,
): readonly DeclarationFailure[] {
  const value = endpoint[field];
  if (value === undefined || allowed.includes(value)) {
    return [];
  }
  return [failure([...at, field], rule, `${noun} is ${oneOf(allowed)}: ${String(value)}`)];
}

/** A Success declares an allowed status; HEAD and 204 answer no body, every other status one. */
function successFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const success: Partial<Endpoint['success']> | undefined = endpoint.success;
  if (typeof success !== 'object' || success === null || success.status === undefined) {
    return [];
  }
  if (!successStatuses.includes(success.status)) {
    const message = `A Success status is ${oneOf(successStatuses)}: ${String(success.status)}`;
    return [failure([...at, 'success', 'status'], 'success-status', message)];
  }
  const bodyAt = slotAt(at, 'success.body');
  if (endpoint.method === 'HEAD') {
    return success.body === undefined
      ? []
      : [failure(bodyAt, 'success-body', 'A HEAD Endpoint answers no body')];
  }
  if (success.status === 204) {
    return success.body === undefined
      ? []
      : [failure(bodyAt, 'success-body', 'A 204 Success has no body')];
  }
  return success.body === undefined
    ? [failure(bodyAt, 'success-body', `A ${success.status} Success has a body`)]
    : [];
}

function inputBodyFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const takesNoBody = endpoint.method === 'GET' || endpoint.method === 'HEAD';
  if (!takesNoBody || endpoint.input?.body === undefined) {
    return [];
  }
  const message = 'A GET or HEAD Endpoint takes no body';
  return [failure(slotAt(at, 'input.body'), 'input-body', message)];
}

/** Several allowed values in one sentence: `200, 201 or 204`. */
function oneOf(allowed: readonly unknown[]): string {
  const names = allowed.map(String);
  const last = names.at(-1);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${last}`;
}
