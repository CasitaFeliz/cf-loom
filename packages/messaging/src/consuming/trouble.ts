import type { Command, Subscription } from '@cf-loom/contract';
import {
  faultLineOf,
  faultLogOf,
  type HandlerFaultBase,
  hookFailureOf,
} from '@cf-loom/handlers/internal';
import type { ConsumerTrouble } from '../broker/index.ts';
import type { CoreConsumer } from './details.ts';

/**
 * What `onBrokerTrouble` receives: the Subscription or the Command's Message Version whose durable
 * consumer stopped being pulled from, with why, or is answered again; names unprefixed, as `connect` gives them.
 */
export type BrokerTrouble = HandlerFaultBase<Subscription | Command> & {
  readonly durable: string;
  readonly stream: string;
} & ({ readonly kind: 'pull-failed'; readonly cause: unknown } | { readonly kind: 'recovered' });

/** The Service's `onBrokerTrouble`, which may be async and is awaited. */
export type BrokerTroubleHook = (trouble: BrokerTrouble) => void | Promise<void>;

/** Tells the Service of a `BrokerTrouble`; resolves once told, never rejecting. */
export type TroubleTell = (trouble: BrokerTrouble) => Promise<void>;

/** The Service's hook, contained so that its failure is logged, or the console line of every report. */
export function troubleTellOf(onBrokerTrouble: BrokerTroubleHook | undefined): TroubleTell {
  return onBrokerTrouble === undefined ? logBrokerTrouble : hookedOf(onBrokerTrouble);
}

/**
 * The `troubled` an adapter reports to: it names the consumer by its Durable consumer among
 * `consumers`, so one the core did not hand the Broker throws to the adapter, and tells the
 * Service without waiting; once `closing` aborted, it tells nothing.
 */
export function troubledOf(
  consumers: readonly CoreConsumer[],
  closing: AbortSignal,
  tell: TroubleTell,
): (trouble: ConsumerTrouble) => void {
  const byDurable = new Map(consumers.map((consumer) => [consumer.durable, consumer]));
  return ({ consumer, ...change }) => {
    const handed = byDurable.get(consumer.durable);
    if (handed === undefined) {
      throw new Error(`${consumer.durable} is no Durable consumer messaging handed this Broker`);
    }
    const { declaration, identity, durable, stream } = handed;
    if (!closing.aborted) {
      void tell({ declaration, identity, durable, stream, ...change });
    }
  };
}

function hookedOf(onBrokerTrouble: BrokerTroubleHook): TroubleTell {
  return async (trouble) => {
    const called = { source: sourceOf(trouble), hook: 'onBrokerTrouble' } as const;
    await hookFailureOf(onBrokerTrouble, trouble, called);
  };
}

async function logBrokerTrouble(trouble: BrokerTrouble): Promise<void> {
  const source = sourceOf(trouble);
  switch (trouble.kind) {
    case 'pull-failed':
      console.error(...faultLogOf(source, { message: 'pulls are failing', cause: trouble.cause }));
      return;
    case 'recovered':
      console.error(faultLineOf(source, { message: 'pulls are answered again' }));
      return;
  }
}

/** What names a durable consumer in a line: the declaration it is pulled for, its name and its stream. */
function sourceOf({ identity, durable, stream }: BrokerTrouble): string {
  return `${identity} ${durable} ${stream}`;
}
