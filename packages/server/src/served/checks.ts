import type { Endpoint, Guard, ServiceContract } from '@cf-loom/contract';
import {
  failureLineOf,
  isServiceContract,
  isStamp,
  ownOf,
  type TextPartNodes,
  walkedTextPartsOf,
} from '@cf-loom/contract/internal';
import type { HandlerMap } from '@cf-loom/handlers';
import { mappedHandlerOf } from '@cf-loom/handlers/internal';

/** What of the Handler map `serve` reads: the Handlers of Endpoints and Guards, and the stamps. */
export type ServedHandlers = Pick<HandlerMap, 'endpoints' | 'guards' | 'deprecatedAt'>;

/** The Root `serve` answers for, which must be a Service's Contract; anything else is a bug of the Service. */
export function contractOf(root: unknown): ServiceContract {
  if (!isServiceContract(root)) {
    throw new Error("serve() takes a Service's Contract declared with defineService");
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
  contract: ServiceContract,
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
