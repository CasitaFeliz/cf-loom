import { ownOf } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { type HandledElement, isPairing, type MessageElement } from '../calls/index.ts';
import type { HandlerMap } from './handler.ts';
import { isWrittenFor, isWrittenForPairing } from './written.ts';

/** Where in the Handler map a Handler sits: its map and its key there, which an error names. */
export type MapKey = {
  readonly map: Exclude<keyof HandlerMap, 'deprecatedAt' | 'readers'>;
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

/**
 * The Handler a map holds for a Command's Message Version or a Subscription, with the Reader its
 * `readers` pair with it: the Handler must be written for that very pairing, which must be of
 * that very Element; throws, naming the key, otherwise.
 */
export function mappedMessageHandlerOf<Element extends MessageElement>(
  map: Pick<HandlerMap, 'commands' | 'subscriptions' | 'readers'>,
  at: MapKey & { readonly map: 'commands' | 'subscriptions' },
  element: Element,
): { readonly handler: { readonly element: Element }; readonly reader: core.$ZodType } {
  const handler = mappedHandlerOf(map[at.map], at, element);
  const paired = `readers.${at.map}.${at.key}`;
  const pairing = ownOf(ownOf(map.readers, at.map), at.key);
  if (!isPairing(pairing)) {
    throw new Error(`${paired} is not in the Handler map: run cf-loom generate`);
  }
  if (pairing.element !== element) {
    throw new Error(
      `${paired} pairs another declaration than the Contract's: run cf-loom generate`,
    );
  }
  if (!isWrittenForPairing(handler, pairing)) {
    throw new Error(
      `${at.map}.${at.key} holds a Handler written for another pairing than ${paired}: run cf-loom generate`,
    );
  }
  return { handler, reader: pairing.reader };
}
