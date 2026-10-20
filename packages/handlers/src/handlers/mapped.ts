import type { HandledElement } from '../calls/index.ts';
import type { HandlerMap } from './handler.ts';
import { isWrittenFor } from './written.ts';

/** Where in the Handler map a Handler sits: its map and its key there, which an error names. */
export type MapKey = {
  readonly map: Exclude<keyof HandlerMap, 'deprecatedAt'>;
  readonly key: string;
};

/**
 * The Handler a map holds as its own under a key, written by `handle()` for that very Element;
 * throws, naming the key, otherwise.
 */
export function mappedHandlerOf<Element extends HandledElement>(
  byName: unknown,
  at: MapKey,
  element: Element,
): { readonly element: Element } {
  const handler = ownOf(byName, at.key);
  if (handler === undefined) {
    throw new Error(`${at.map}.${at.key} has no Handler in the Handler map`);
  }
  if (!isWrittenFor(handler, element)) {
    throw new Error(
      `${at.map}.${at.key} holds no Handler handle() returned for it: run cf-loom generate`,
    );
  }
  return handler;
}

/** A value a map holds itself under a name, whatever the map is; nothing it only inherits. */
export function ownOf(byName: unknown, name: string): unknown {
  if (typeof byName !== 'object' || byName === null || !Object.hasOwn(byName, name)) {
    return undefined;
  }
  return Reflect.get(byName, name);
}
