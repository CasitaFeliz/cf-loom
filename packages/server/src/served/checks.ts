import type { Contract, Endpoint, Guard } from '@casitafeliz/loom-contract';
import {
  failureLineOf,
  isContract,
  type TextNodes,
  textNodesOf,
} from '@casitafeliz/loom-contract/internal';
import type { HandlerMap } from '@casitafeliz/loom-handlers';
import { isWrittenFor } from '@casitafeliz/loom-handlers/internal';

/** What of the Handler map `serve` reads: the Handlers of Endpoints and Guards, and the stamps. */
export type ServedHandlers = Pick<HandlerMap, 'endpoints' | 'guards' | 'deprecatedAt'>;

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
  return writtenHandlerOf(handlers.endpoints, `endpoints.${endpoint.name}`, endpoint);
}

/** The Handler the map holds for a Guard a live Endpoint attaches, written for that very Guard. */
export function guardHandlerOf(
  handlers: ServedHandlers,
  guard: Guard,
): { readonly element: Guard } {
  return writtenHandlerOf(handlers.guards, `guards.${guard.name}`, guard);
}

/** The walked text parts of an Endpoint or a Guard, which must be what `generate` accepts. */
export function textNodesFor(declaration: Endpoint | Guard): Extract<TextNodes, { kind: 'valid' }> {
  const walked = textNodesOf(declaration);
  if (walked.kind === 'invalid') {
    const lines = walked.failures.map(failureLineOf);
    throw new Error(`serve() cannot read the text of ${declaration.name}:\n${lines.join('\n')}`);
  }
  return walked;
}

/** A Deprecated Endpoint's `deprecatedAt`, which the map must carry; none for any other. */
export function deprecatedAtOf(handlers: ServedHandlers, endpoint: Endpoint): string | undefined {
  if (endpoint.lifecycle !== 'deprecated') {
    return undefined;
  }
  const stamp = ownOf(handlers.deprecatedAt, endpoint.name);
  if (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp))) {
    const message = `deprecatedAt.${endpoint.name} is missing from the Handler map: run cf-loom generate`;
    throw new Error(message);
  }
  return stamp;
}

function writtenHandlerOf<Element extends Endpoint | Guard>(
  byName: Readonly<Record<string, unknown>>,
  key: string,
  element: Element,
): { readonly element: Element } {
  const handler = ownOf(byName, element.name);
  if (handler === undefined) {
    throw new Error(`${key} has no Handler in the Handler map`);
  }
  if (!isWrittenFor(handler, element)) {
    throw new Error(`${key} holds no Handler handle() returned for it: run cf-loom generate`);
  }
  return handler as { readonly element: Element };
}

function ownOf(byName: Readonly<Record<string, unknown>>, name: string): unknown {
  return Object.hasOwn(byName, name) ? byName[name] : undefined;
}
