import { ownOf } from '@cf-loom/contract/internal';
import type * as core from 'zod/v4/core';
import { type Handled, isPairing, type MessageHandled, nameOf } from '../calls/index.ts';
import type { HandlerMap } from './handler.ts';
import { isWrittenForPairing, writtenDeclarationOf } from './written.ts';

/** Where in the Handler map a Handler sits: its map and its key there, which an error names. */
export type MapKey = {
  readonly map: Exclude<keyof HandlerMap, 'readers'>;
  readonly key: string;
};

/**
 * The Handler a map holds as its own under a key, written by `handle()` for that very declaration;
 * throws, naming the key, otherwise.
 */
export function mappedHandlerOf<Declaration extends Handled>(
  byName: unknown,
  at: MapKey,
  declaration: Declaration,
): { readonly declaration: Declaration } {
  const where = `${at.map}.${at.key}`;
  const handler = ownOf(byName, at.key);
  if (handler === undefined) {
    throw new Error(`${where} has no Handler in the Handler map: run cf-loom generate`);
  }
  const written = writtenDeclarationOf(handler);
  if (written !== declaration) {
    throw new Error(`${where} ${mismatchOf(written, declaration)}`);
  }
  return handler as { readonly declaration: Declaration };
}

/**
 * What a key holds instead of the Handler written for its declaration: a value `handle()` did not
 * return, the Handler of another copy of that declaration, or the Handler of another declaration.
 */
function mismatchOf(written: Handled | undefined, declaration: Handled): string {
  if (written === undefined) {
    return 'holds a value handle() did not return: wrap inside the implementation instead';
  }
  const name = nameOf(declaration);
  if (written.kind === declaration.kind && nameOf(written) === name) {
    return `holds a Handler written for another copy of ${name}: is @cf-loom/contract or the Contract loaded twice?`;
  }
  return `holds the Handler written for ${nameOf(written)}`;
}

/**
 * The Handler a map holds for a Command's Message Version or a Subscription, with the Reader its
 * `readers` pair with it: the Handler must be written for that very pairing; throws, naming the
 * key, otherwise.
 */
export function mappedMessageHandlerOf<Declaration extends MessageHandled>(
  map: Pick<HandlerMap, 'commands' | 'subscriptions' | 'readers'>,
  at: MapKey & { readonly map: 'commands' | 'subscriptions' },
  declaration: Declaration,
): { readonly handler: { readonly declaration: Declaration }; readonly reader: core.$ZodType } {
  const handler = mappedHandlerOf(map[at.map], at, declaration);
  const paired = `readers.${at.map}.${at.key}`;
  const pairing = ownOf(ownOf(map.readers, at.map), at.key);
  if (!isPairing(pairing)) {
    throw new Error(`${paired} is not in the Handler map: run cf-loom generate`);
  }
  if (!isWrittenForPairing(handler, pairing)) {
    throw new Error(
      `${at.map}.${at.key} holds a Handler written for another pairing than ${paired}: run cf-loom generate`,
    );
  }
  return { handler, reader: pairing.reader };
}
