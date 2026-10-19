import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import { partFieldOf, schemaOf, successParts } from '@casitafeliz/loom-contract/internal';
import type {
  AnyAdmission,
  AnyOutcome,
  BuiltSuccess,
  ResolvedAdmission,
  ResolvedOutcome,
} from '../outcomes/index.ts';
import { type Checked, checkedAll, checkedPart, fieldOf, mapValue } from './checked.ts';
import { checkedEndpointRejection, checkedGuardRejection } from './rejection.ts';

/**
 * What an EndpointHandler built, checked against its Endpoint and resolved, as `serve` sends it:
 * parsed with its schema as written, and a valid Contract declares no strict object, so unknown
 * keys are stripped.
 */
export function checkedOutcome(
  endpoint: Endpoint,
  built: AnyOutcome,
  standards: StandardRejections,
): Checked<ResolvedOutcome<Endpoint>> {
  switch (built.kind) {
    case 'success':
      return checkedSuccess(endpoint, built);
    case 'rejection':
      return checkedEndpointRejection(endpoint, built, standards);
    case 'fault':
      return { kind: 'value', value: built };
  }
}

/**
 * What a GuardHandler built, checked against its Guard and resolved: parsed with its schema as
 * written, and a valid Contract declares no strict object, so unknown keys are stripped.
 */
export function checkedAdmission(
  guard: Guard,
  built: AnyAdmission,
  standards: StandardRejections,
): Checked<ResolvedAdmission<Guard>> {
  switch (built.kind) {
    case 'admitted': {
      const context = checkedPart('context', schemaOf(guard, 'context'), { value: built.context });
      return mapValue(context, (parsed) => ({ kind: 'admitted', context: parsed }));
    }
    case 'rejection':
      return checkedGuardRejection(guard, built, standards);
    case 'fault':
      return { kind: 'value', value: built };
  }
}

/**
 * The value a Handler gave `success()`, read by its Endpoint: the body, or `{ headers, body }`
 * when the Endpoint declares headers; only the parts it declares come back.
 */
function checkedSuccess(
  endpoint: Endpoint,
  { value }: BuiltSuccess<unknown>,
): Checked<ResolvedOutcome<Endpoint>> {
  const given = schemaOf(endpoint, 'success.headers') === undefined ? { body: value } : value;
  const parts = successParts.map((part) => ({
    part,
    field: partFieldOf(part),
    schema: schemaOf(endpoint, part),
  }));
  const checks = parts.map(({ part, field, schema }) => {
    return [field, checkedPart(part, schema, { value: fieldOf(given, field) })] as const;
  });
  const declared = parts.filter(({ schema }) => schema !== undefined);
  return mapValue(checkedAll(Object.fromEntries(checks)), (parsed) => {
    const entries = declared.map(({ field }) => [field, parsed[field]]);
    return { kind: 'success', status: endpoint.success.status, ...Object.fromEntries(entries) };
  });
}
