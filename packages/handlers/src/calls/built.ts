import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type Checked,
  type CheckedRejection,
  checkedAdmitted,
  checkedRejection,
  checkedSuccess,
  resolutionOf,
} from '../checks/index.ts';
import { type Fault, thrownFault } from '../outcomes/index.ts';

/** What an EndpointHandler builds, before it is checked. */
type EndpointBuilt =
  | { readonly kind: 'success'; readonly value: unknown }
  | CheckedRejection
  | Fault;

/** What a GuardHandler builds, before it is checked. */
type GuardBuilt =
  | { readonly kind: 'admitted'; readonly context: unknown }
  | CheckedRejection
  | Fault;

/** The kinds an EndpointHandler builds. */
export const endpointKinds = ['success', 'rejection', 'fault'] as const;

/** The kinds a GuardHandler builds. */
export const guardKinds = ['admitted', 'rejection', 'fault'] as const;

type Built = EndpointBuilt | GuardBuilt;

/**
 * What the implementation built, awaited; a throw, or a value of no kind its Element answers, is
 * the Fault `Internal error` with what went wrong as `cause`.
 */
export async function builtOf<Kind extends Built['kind']>(
  element: Endpoint | Guard,
  implementation: () => unknown,
  kinds: readonly Kind[],
): Promise<Extract<Built, { readonly kind: Kind }> | Fault> {
  try {
    const built = await implementation();
    if (isBuiltOf(built, kinds)) {
      return built;
    }
    return thrownFault(
      new TypeError(`${element.name}'s Handler returned no Outcome but ${describedOf(built)}`),
    );
  } catch (e) {
    return thrownFault(e);
  }
}

/** An EndpointHandler's Outcome checked against its Endpoint and resolved, as `serve` sends it. */
export function resolvedOutcomeOf(
  endpoint: Endpoint,
  built: EndpointBuilt,
  standards: StandardRejections,
): Checked<unknown> {
  switch (built.kind) {
    case 'success':
      return checkedSuccess(endpoint, built.value);
    case 'rejection':
      return resolvedRejectionOf(endpoint, built, standards);
    case 'fault':
      return { kind: 'value', value: built };
  }
}

/** A GuardHandler's Admission checked against its Guard and resolved. */
export function resolvedAdmissionOf(
  guard: Guard,
  built: GuardBuilt,
  standards: StandardRejections,
): Checked<unknown> {
  switch (built.kind) {
    case 'admitted':
      return admittedOf(guard, built.context);
    case 'rejection':
      return resolvedRejectionOf(guard, built, standards);
    case 'fault':
      return { kind: 'value', value: built };
  }
}

function admittedOf(guard: Guard, context: unknown): Checked<unknown> {
  const checked = checkedAdmitted(guard, context);
  if (checked.kind === 'issues') {
    return checked;
  }
  return { kind: 'value', value: { kind: 'admitted', context: checked.value } };
}

function resolvedRejectionOf(
  element: Endpoint | Guard,
  built: CheckedRejection,
  standards: StandardRejections,
): Checked<unknown> {
  const checked = checkedRejection(element, built);
  if (checked.kind === 'issues') {
    return checked;
  }
  const resolution = resolutionOf(checked.value.rejection, standards);
  return { kind: 'value', value: { ...checked.value, ...resolution } };
}

function isBuiltOf<Kind extends Built['kind']>(
  built: unknown,
  kinds: readonly Kind[],
): built is Extract<Built, { readonly kind: Kind }> {
  if (typeof built !== 'object' || built === null || !('kind' in built)) {
    return false;
  }
  const builtKinds: readonly unknown[] = kinds;
  return builtKinds.includes(built.kind);
}

/** What a Handler returned instead of an Outcome, by its type or kind, never its content. */
function describedOf(built: unknown): string {
  if (built === null) {
    return 'null';
  }
  if (typeof built === 'object' && 'kind' in built) {
    return `the kind ${String(built.kind)}`;
  }
  return typeof built;
}
