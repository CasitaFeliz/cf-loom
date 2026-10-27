import type { Command, Subscription } from '@cf-loom/contract';
import {
  faultLineOf,
  faultLogOf,
  type HandlerFaultBase,
  hookFailureOf,
} from '@cf-loom/handlers/internal';
import type { DurableConsumerTrouble } from '../broker/index.ts';
import type { CoreDurableConsumer } from './details.ts';

/**
 * What `onBrokerTrouble` receives: the Subscription or the Command's Message Version whose
 * Durable consumer stopped being pulled from, with why, or is answered again; names unprefixed, as `connect` gives them.
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
 * The `troubled` an adapter reports to: it names the Durable consumer by its `durable` among
 * `durableConsumers`, so one the core did not hand the Broker throws to the adapter, and tells the
 * Service without waiting; once `closing` aborted, it tells nothing.
 */
export function troubledOf(
  durableConsumers: readonly CoreDurableConsumer[],
  closing: AbortSignal,
  tell: TroubleTell,
): (trouble: DurableConsumerTrouble) => void {
  const byDurable = new Map(
    durableConsumers.map((durableConsumer) => [durableConsumer.durable, durableConsumer]),
  );
  return ({ durableConsumer, ...change }) => {
    const handed = byDurable.get(durableConsumer.durable);
    if (handed === undefined) {
      throw new Error(
        `${durableConsumer.durable} is no Durable consumer messaging handed this Broker`,
      );
    }
    const { declaration, name, durable, stream } = handed;
    if (!closing.aborted) {
      void tell({ declaration, name, durable, stream, ...change });
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

/** What names a Durable consumer in a line: the declaration's `name`, its `durable` and its stream. */
function sourceOf({ name, durable, stream }: BrokerTrouble): string {
  return `${name} ${durable} ${stream}`;
}
