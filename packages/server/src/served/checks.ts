import type { Contract, Endpoint, Guard } from '@casitafeliz/loom-contract';
import {
  failureLineOf,
  isContract,
  isStamp,
  type WalkedTextParts,
  walkedTextPartsOf,
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
export function checkedTextPartsOf(
  declaration: Endpoint | Guard,
): Extract<WalkedTextParts, { kind: 'valid' }> {
  const walked = walkedTextPartsOf(declaration);
  if (walked.kind === 'invalid') {
    const lines = walked.failures.map(failureLineOf);
    throw new Error(`serve() cannot read the text of ${declaration.name}:\n${lines.join('\n')}`);
  }
  return walked;
}

/**
 * The stamp a Deprecated Endpoint's responses carry, which the map must hold as `generate` writes
 * it; none for any other Endpoint, whatever the map holds.
 */
export function stampOf(handlers: ServedHandlers, endpoint: Endpoint): string | undefined {
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

function writtenHandlerOf<Element extends Endpoint | Guard>(
  byName: unknown,
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
  return handler;
}

/** A value the map holds itself under a name, whatever the map is; nothing it only inherits. */
function ownOf(byName: unknown, name: string): unknown {
  if (typeof byName !== 'object' || byName === null || !Object.hasOwn(byName, name)) {
    return undefined;
  }
  return Reflect.get(byName, name);
}
