import type { Endpoint } from '../declarations/index.ts';
import {
  isUtcInstant,
  lifecycles,
  methods,
  successStatuses,
  visibilities,
} from '../declarations/index.ts';
import {
  isMissing,
  isWithoutValue,
  type LocatedEndpoint,
  slotAt,
  textOf,
} from '../written/index.ts';
import { type ClosedValue, closedValueFailures, lifecycle, oneOf } from './closed-values.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A closed value of an Endpoint, by the field it sits in. */
type EndpointClosedValue = ClosedValue & { readonly field: keyof Endpoint };

const closedValues: readonly EndpointClosedValue[] = [
  { field: 'method', rule: 'method', allowed: methods, noun: 'A method' },
  { field: 'visibility', rule: 'visibility', allowed: visibilities, noun: 'A Visibility' },
  { field: 'lifecycle', ...lifecycle },
];

/** The rules of an Endpoint alone: its closed values, its Success's status and where a body belongs. */
export function endpointFailures(located: LocatedEndpoint): readonly DeclarationFailure[] {
  return [
    ...closedValues.flatMap((closed) =>
      closedValueFailures(
        { at: [...located.at, closed.field], value: located.endpoint[closed.field] },
        closed,
      ),
    ),
    ...deprecationFailures(located),
    ...successFailures(located),
    ...inputBodyFailures(located),
  ];
}

/**
 * An Endpoint declares `deprecatedAt` exactly when it is Deprecated, a UTC instant to the second;
 * a lifecycle that is none is the lifecycle rule's finding alone.
 */
function deprecationFailures(located: LocatedEndpoint): readonly DeclarationFailure[] {
  const written: unknown = located.endpoint.lifecycle;
  if (written === 'deprecated') {
    return instantFailures(located);
  }
  const isKnown = written === undefined || lifecycles.some((known) => known === written);
  return isKnown ? undeclaredInstantFailures(located) : [];
}

/** A Deprecated Endpoint states its instant; a value that is no text is the field rules' finding. */
function instantFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const deprecatedAt: unknown = endpoint.deprecatedAt;
  const isNoInstant =
    isMissing(deprecatedAt) || (typeof deprecatedAt === 'string' && !isUtcInstant(deprecatedAt));
  const message =
    "A Deprecated Endpoint's deprecatedAt is a UTC instant to the second, such as 2026-11-01T00:00:00Z";
  return isNoInstant ? [failure([...at, 'deprecatedAt'], 'deprecated-at', message)] : [];
}

/** An Endpoint that is not Deprecated states no instant. */
function undeclaredInstantFailures({
  at,
  endpoint,
}: LocatedEndpoint): readonly DeclarationFailure[] {
  const message = 'Only a Deprecated Endpoint declares deprecatedAt';
  return isMissing(endpoint.deprecatedAt)
    ? []
    : [failure([...at, 'deprecatedAt'], 'deprecated-at', message)];
}

/** A Success declares an allowed status; 204 answers no body, every other status one. */
function successFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const success: Partial<Endpoint['success']> | undefined = endpoint.success;
  if (typeof success !== 'object' || success === null || isWithoutValue(success.status)) {
    return [];
  }
  if (!successStatuses.includes(success.status)) {
    const message = `A Success status is ${oneOf(successStatuses)}: ${textOf(success.status)}`;
    return [failure([...at, 'success', 'status'], 'success-status', message)];
  }
  const bodyAt = slotAt(at, 'success.body');
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
  if (endpoint.method !== 'GET' || isMissing(endpoint.input?.body)) {
    return [];
  }
  const message = 'A GET Endpoint takes no body';
  return [failure(slotAt(at, 'input.body'), 'input-body', message)];
}
