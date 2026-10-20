import type { Contract, Endpoint, Guard } from '@cf-loom/contract';
import {
  failureLineOf,
  isContract,
  isStamp,
  type TextPartNodes,
  walkedTextPartsOf,
} from '@cf-loom/contract/internal';
import { mappedHandlerOf, ownOf } from '@cf-loom/handlers/internal';
import type { serve } from '../answering/index.ts';

/**
 * What of the Handler map `serve` reads, as its signature takes it: the Handlers of Endpoints and
 * Guards, and the stamps. A type-only import, so `served/` still runs before `answering/`.
 */
export type ServedHandlers = Parameters<typeof serve>[1];

/** The root `serve` answers for, which must be a Contract; anything else is a bug of the Service. */
export function contractOf(root: unknown): Contract {
  if (!isContract(root)) {
    throw new Error('serve() takes a Contract declared with defineContract');
  }
  return root;
}

/** The Handler the map holds for a live Endpoint, which `handle()` returned for that very Endpoint. */
export function endpointHandlerOf(
  handlers: ServedHandlers,
  endpoint: Endpoint,
): { readonly element: Endpoint } {
  return mappedHandlerOf(handlers.endpoints, { map: 'endpoints', key: endpoint.name }, endpoint);
}

/** The Handler the map holds for a Guard a live Endpoint attaches, written for that very Guard. */
export function guardHandlerOf(
  handlers: ServedHandlers,
  guard: Guard,
): { readonly element: Guard } {
  return mappedHandlerOf(handlers.guards, { map: 'guards', key: guard.name }, guard);
}

/** The walked text parts of every Endpoint and Guard, which must be what `generate` accepts. */
export function checkedTextPartsOf(
  contract: Contract,
): ReadonlyMap<Endpoint | Guard, TextPartNodes> {
  const walked = walkedTextPartsOf(contract);
  if (walked.kind === 'invalid') {
    const lines = walked.failures.map(failureLineOf);
    throw new Error(`serve() takes a Contract generate accepts:\n${lines.join('\n')}`);
  }
  return walked.nodes;
}

/**
 * The stamp a Deprecated Endpoint's responses carry, which the map must hold as `generate` writes
 * it; none for any other Endpoint, whatever the map holds.
 */
export function deprecatedAtOf(handlers: ServedHandlers, endpoint: Endpoint): string | undefined {
  if (endpoint.lifecycle !== 'deprecated') {
    return undefined;
  }
  const stamp = ownOf(handlers.deprecatedAt, endpoint.name);
  if (!isStamp(stamp)) {
    const message = `deprecatedAt.${endpoint.name} is missing or not an instant in the Handler map: run cf-loom generate`;
    throw new Error(message);
  }
  return stamp;
}
