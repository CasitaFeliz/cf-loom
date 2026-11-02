import { vi } from 'vitest';
import { inProcess } from '../src/in-process/index.ts';
import { type Broker, type ConsumedFault, DeadlineError, messaging } from '../src/index.ts';
import { commandWordOf, eventWordOf, pascalOf, type Run } from './in-process-draw.ts';
import type { PublishedMessage } from './in-process-oracle.ts';
import {
  contractsOf,
  handlerMapOf,
  type Observation,
  type Start,
  subjectsOf,
} from './in-process-run-services.ts';

/** A Handler that ran past its wait. */
export type Deadline = {
  readonly handler: string;
  readonly deliveryCount: number;
  readonly waitMs: number;
};

/** What a run of both Services over one `inProcess()` did. */
export type Observed = {
  readonly published: readonly PublishedMessage[];
  readonly duplicates: readonly boolean[];
  readonly starts: readonly Start[];
  readonly deadlines: readonly Deadline[];
  readonly mostAtOnce: number;
  readonly startsAfterDrain: number;
  readonly timersLeft: number;
  readonly subjects: Readonly<Record<string, string>>;
};

/** A Service of a run as the test drives it, whatever its Contract. */
type Driven = {
  readonly publisher: {
    readonly publish: (
      name: string,
      bodies: Readonly<Record<string, unknown>>,
      options: { readonly factId: string },
    ) => Promise<unknown>;
  };
  readonly sender: {
    readonly send: (
      name: string,
      body: unknown,
      options: { readonly factId: string },
    ) => Promise<unknown>;
  };
  readonly consume: (handlers: never, options: object) => Promise<void>;
  readonly close: () => Promise<void>;
};

type Taken = Parameters<Awaited<ReturnType<Broker['connect']>>['publish']>[0];

/** A Broker that tells of every Message it takes, and of whether the Broker underneath answered a duplicate. */
function observing(
  broker: Broker,
  taken: (message: Taken) => void,
  answered: (duplicate: boolean) => void,
): Broker {
  return {
    connect: async (serviceStream) => {
      const connection = await broker.connect(serviceStream);
      return {
        ...connection,
        publish: async (message) => {
          taken(message);
          const ack = await connection.publish(message);
          answered(ack.duplicate);
          return ack;
        },
      };
    },
  };
}

/** Advances the fake clock to the next timer until none is left, and none is armed by what the last one set going. */
async function drain(): Promise<void> {
  for (let quietTurns = 0; quietTurns < 3; ) {
    await vi.advanceTimersToNextTimerAsync();
    quietTurns = vi.getTimerCount() === 0 ? quietTurns + 1 : 0;
  }
}

/** The Services of a draw connected through one `inProcess()` that records what it takes. */
async function connectedOf(run: Run) {
  const contracts = contractsOf(run);
  const published: PublishedMessage[] = [];
  const duplicates: boolean[] = [];
  const deadlines: Deadline[] = [];
  const state = { billingConsuming: false };
  const broker = observing(
    inProcess(run.limits),
    (message) => {
      const { copy } = JSON.parse(new TextDecoder().decode(message.body)) as { copy: string };
      const { subject, messageId } = message;
      published.push({ subject, messageId, copy, billingConsuming: state.billingConsuming });
    },
    (duplicate) => void duplicates.push(duplicate),
  );
  const onServiceFault = (consumed: ConsumedFault) => {
    if (consumed.kind === 'thrown' && consumed.cause instanceof DeadlineError) {
      const { name: handler, deliveryCount } = consumed;
      deadlines.push({ handler, deliveryCount, waitMs: consumed.cause.waitMs });
    }
  };
  const orders = await messaging(contracts.orders, broker, { onServiceFault });
  const billing = await messaging(contracts.billing, broker, { onServiceFault });
  return {
    contracts,
    state,
    published,
    duplicates,
    deadlines,
    orders: orders as unknown as Driven,
    billing: billing as unknown as Driven,
  };
}

type Connected = Awaited<ReturnType<typeof connectedOf>>;

/** Does what the actions say: publishes and sends from orders-service, passes time, and starts billing-service consuming. */
async function act(run: Run, connected: Connected, observation: Observation): Promise<void> {
  const { orders, billing, state, contracts } = connected;
  const billingHandlers = handlerMapOf(run, observation, {
    commands: [],
    subscriptions: contracts.invoicing,
  });
  let copies = 0;
  for (const action of run.actions) {
    const body = { copy: `c${copies++}` };
    switch (action.kind) {
      case 'publish':
        await orders.publisher.publish(
          pascalOf(eventWordOf(action.event)),
          { v1: body },
          { factId: action.factId },
        );
        break;
      case 'send':
        await orders.sender.send(pascalOf(commandWordOf(action.command)), body, {
          factId: action.factId,
        });
        break;
      case 'advance':
        await vi.advanceTimersByTimeAsync(action.ms);
        break;
      case 'consume-billing':
        await billing.consume(billingHandlers as never, {});
        state.billingConsuming = true;
        break;
    }
  }
}

/** Runs both Services of a draw over one `inProcess()` under fake timers: the actions, then every timer, then an hour more, then closing. */
export async function performRun(run: Run): Promise<Observed> {
  const connected = await connectedOf(run);
  const observation: Observation = { starts: [], running: new Map(), mostAtOnce: 0 };
  await connected.orders.consume(handlerMapOf(run, observation, connected.contracts) as never, {});
  await act(run, connected, observation);
  await drain();
  const timersLeft = vi.getTimerCount();
  const startsBeforeAnHour = observation.starts.length;
  await vi.advanceTimersByTimeAsync(3_600_000);
  await Promise.all([connected.orders.close(), connected.billing.close()]);
  return {
    published: connected.published,
    duplicates: connected.duplicates,
    starts: observation.starts,
    deadlines: connected.deadlines,
    mostAtOnce: observation.mostAtOnce,
    startsAfterDrain: observation.starts.length - startsBeforeAnHour,
    timersLeft,
    subjects: subjectsOf([connected.contracts.orders, connected.contracts.billing]),
  };
}
