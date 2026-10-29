import type { Command, Subscription } from '@cf-loom/contract';
import type { Closed } from '@cf-loom/contract/internal';
import { isPairing, type Pairing } from '../calls/index.ts';

/** Each Command's Message Version and Subscription with its Reader, keyed as the Handler map keys their Handlers. */
export type Readers = {
  readonly commands: Readonly<Record<string, Pairing<Command>>>;
  readonly subscriptions: Readonly<Record<string, Pairing<Subscription>>>;
};

const tableKeys = ['commands', 'subscriptions'] as const;

/** Pairs each Command's Message Version and Subscription with the Reader schema generated from the Snapshot, so its Handler reads a body as a Subscriber does; the readers file calls it. */
export function readersOf<const Table extends Readers>(table: Closed<Table, Readers>): Table {
  const refused = refusedKeyOf(table);
  if (refused !== undefined) {
    throw new Error(
      `readersOf() takes commands and subscriptions, each a Command or Subscription declared with @cf-loom/contract and a zod schema: ${refused}`,
    );
  }
  for (const key of tableKeys) {
    for (const pairing of Object.values(table[key])) {
      Object.freeze(pairing);
    }
    Object.freeze(table[key]);
  }
  Object.freeze(table);
  return table;
}

/** The first key the table cannot be built with: a table left out or no object, or a pairing that is none. */
function refusedKeyOf(table: Readers): string | undefined {
  for (const key of tableKeys) {
    const pairings: unknown = table[key];
    if (typeof pairings !== 'object' || pairings === null) {
      return key;
    }
    for (const [name, pairing] of Object.entries(pairings)) {
      if (!isPairing(pairing)) {
        return `${key}.${name}`;
      }
    }
  }
  return undefined;
}
