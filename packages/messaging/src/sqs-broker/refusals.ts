import { unbrokenLineOf } from '@cf-loom/contract/internal';

/** The Durable consumers of Messages that SQS refused to settle once closing started, which `close` rejects for. */
export type Refusals = {
  readonly refused: (durable: string, error: unknown) => void;
  /** The error `close` rejects with, or `undefined` when SQS refused nothing. */
  readonly error: () => Error | undefined;
};

/** A record of the Settlements SQS refused once closing started: each Durable consumer once, the first error of all as the cause. */
export function refusalsOf(): Refusals {
  const causes = new Map<string, unknown>();
  return {
    refused: (durable, error) => {
      if (!causes.has(durable)) {
        causes.set(durable, error);
      }
    },
    error: () => {
      const [cause] = causes.values();
      const durables = [...causes.keys()].join(', ');
      return causes.size === 0
        ? undefined
        : new Error(
            unbrokenLineOf(`SQS refused to settle Messages of the Durable consumers ${durables}`),
            { cause },
          );
    },
  };
}
