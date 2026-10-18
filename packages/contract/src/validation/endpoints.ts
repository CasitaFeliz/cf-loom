import type { Endpoint } from '../endpoint.ts';
import type { LocatedEndpoint } from './declarations.ts';
import { type DeclarationFailure, failure, type Rule } from './failures.ts';

const methods: readonly unknown[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const visibilities: readonly unknown[] = ['public', 'internal', 'private'];
const lifecycles: readonly unknown[] = ['active', 'deprecated', 'retired'];
const successStatuses: readonly unknown[] = [200, 201, 202, 203, 204];

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

function closedValueFailures(
  { at, endpoint }: LocatedEndpoint,
  { field, rule, allowed, noun }: ClosedValue,
): readonly DeclarationFailure[] {
  const value = endpoint[field];
  if (allowed.includes(value) || (field === 'lifecycle' && value === undefined)) {
    return [];
  }
  return [failure([...at, field], rule, `${noun} is ${oneOf(allowed)}: ${String(value)}`)];
}

/** A Success declares an allowed status; HEAD and 204 answer no body, every other status one. */
function successFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const success: Partial<Endpoint['success']> = endpoint.success ?? {};
  const bodyAt = [...at, 'success', 'body'];
  if (endpoint.method === 'HEAD') {
    return success.body === undefined
      ? []
      : [failure(bodyAt, 'success-body', 'A HEAD Endpoint answers no body')];
  }
  if (!successStatuses.includes(success.status)) {
    const message = `A Success status is ${oneOf(successStatuses)}: ${String(success.status)}`;
    return [failure([...at, 'success', 'status'], 'success-status', message)];
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
  return [failure([...at, 'input', 'body'], 'input-body', 'A GET or HEAD Endpoint takes no body')];
}

/** Several allowed values in one sentence: `200, 201 or 204`. */
function oneOf(allowed: readonly unknown[]): string {
  const names = allowed.map(String);
  const last = names.at(-1);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${last}`;
}
