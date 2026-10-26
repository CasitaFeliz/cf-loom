import type { Endpoint, Guard, ServiceContract } from '@cf-loom/contract';
import {
  failureLineOf,
  isServiceContract,
  type TextPartNodes,
  walkedTextPartsOf,
} from '@cf-loom/contract/internal';
import type { HandlerMap } from '@cf-loom/handlers';
import { mappedHandlerOf } from '@cf-loom/handlers/internal';

/** What of the Handler map `serve` reads: the Handlers of Endpoints and Guards. */
export type ServedHandlers = Pick<HandlerMap, 'endpoints' | 'guards'>;

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

/**
 * The walked text parts of every Endpoint and Guard, which must be what `generate` accepts, the
 * headers of a Rejection judged too: `serve` walks those schemas itself and reads each request by
 * the nodes the walk gives.
 */
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
