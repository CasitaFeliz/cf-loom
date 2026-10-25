import type { Command, Subscription } from '@cf-loom/contract';
import { isPairing, type Pairing } from '../calls/index.ts';

/** Each Command's Message Version and Subscription with its Reader, keyed as the Handler map keys their Handlers. */
export type Readers = {
  readonly commands: Readonly<Record<string, Pairing<Command>>>;
  readonly subscriptions: Readonly<Record<string, Pairing<Subscription>>>;
};

const tableKeys = ['commands', 'subscriptions'] as const;

/** Pairs each Command's Message Version and Subscription with the Reader schema generated from the Snapshot, so its Handler reads a body as a Subscriber does; the readers file calls it. */
export function readersOf<const Table extends Readers>(table: Table): Readonly<Table> {
  const pairings = tableKeys.flatMap((key) =>
    Object.entries(table[key]).map(([name, pairing]) => ({ at: `${key}.${name}`, pairing })),
  );
  const refused = pairings.find(({ pairing }) => !isPairing(pairing));
  if (refused !== undefined) {
    throw new Error(
      `readersOf() takes commands and subscriptions, each a Command or Subscription declared with @cf-loom/contract and a zod schema: ${refused.at}`,
    );
  }
  for (const { pairing } of pairings) {
    Object.freeze(pairing);
  }
  for (const key of tableKeys) {
    Object.freeze(table[key]);
  }
  return Object.freeze(table);
}
