import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEvent,
  type ServiceContract,
} from '@cf-loom/contract';
import { fault, handle, type MessageFault, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { vi } from 'vitest';
import { z } from 'zod';
import { planOf } from './broker-plans.ts';
import {
  type Answer,
  answerOf,
  commandWordOf,
  eventWordOf,
  pascalOf,
  type Run,
  subscriptionWordsOf,
} from './in-process-draw.ts';

const messageBody = z.object({ copy: z.string() });

/** A Handler's start, with the fake time it began at. */
export type Start = {
  readonly handler: string;
  readonly copy: string;
  readonly deliveryCount: number;
  readonly lastAttempt: boolean;
  readonly at: number;
};

/** What the Handlers of a run record: their starts, and how many of each run at once. */
export type Observation = {
  readonly starts: Start[];
  readonly running: Map<string, number>;
  mostAtOnce: number;
};

function declarationsOf(run: Run) {
  const events = run.subscriptionCounts.map((_, event) =>
    defineEvent({
      name: pascalOf(eventWordOf(event)),
      version: 1,
      visibility: 'internal',
      description: 'An Event',
      body: messageBody,
    }),
  );
  const commands = Array.from({ length: run.commandCount }, (_, command) =>
    defineCommand({
      name: pascalOf(commandWordOf(command)),
      version: 1,
      description: 'A Command',
      body: messageBody,
    }),
  );
  const subscriptions = run.subscriptionCounts.flatMap((count, event) =>
    subscriptionWordsOf(count).map((word) =>
      defineSubscription({
        name: `${eventWordOf(event)}${word}`,
        description: 'A Subscription',
        event: events[event] as (typeof events)[number],
      }),
    ),
  );
  return { events, commands, subscriptions };
}

function invoicingOf(run: Run) {
  const provided = run.billingEvents.map((event) =>
    providedEvent('orders-service', {
      name: pascalOf(eventWordOf(event)),
      version: 1,
      visibility: 'internal',
      description: 'An Event',
      body: messageBody,
    }),
  );
  return run.billingEvents.map((event, at) =>
    defineSubscription({
      name: `${eventWordOf(event)}invoice`,
      description: 'A Subscription',
      event: provided[at] as (typeof provided)[number],
    }),
  );
}

/** A list as a group declares it, which is never empty, or no field at all. */
function listing<Item>(name: string, items: readonly Item[]) {
  const [first, ...later] = items;
  return first === undefined ? {} : { [name]: [first, ...later] };
}

/** The Contracts of orders-service, which publishes, sends and handles, and billing-service, which subscribes to some of its Events. */
export function contractsOf(run: Run) {
  const { events, commands, subscriptions } = declarationsOf(run);
  const invoicing = invoicingOf(run);
  const messages = { name: 'messages', description: 'Messages' };
  const ordersGroup = {
    ...messages,
    ...listing('events', events),
    ...listing('commands', commands),
    ...listing('subscriptions', subscriptions),
  };
  const billingGroup = { ...messages, ...listing('subscriptions', invoicing) };
  const orders = defineService({
    name: 'orders-service',
    groups: [defineGroup(ordersGroup as never)],
  });
  const billing = defineService({
    name: 'billing-service',
    groups: [defineGroup(billingGroup as never)],
  });
  return { orders, billing, commands, subscriptions, invoicing };
}

/** The Broker plan's subject for each Durable consumer of the Contracts. */
export function subjectsOf(contracts: readonly ServiceContract[]): Record<string, string> {
  const subjects: Record<string, string> = {};
  for (const contract of contracts) {
    for (const [durable, { subject }] of Object.entries(planOf(contract, null).durableConsumers)) {
      subjects[durable] = subject;
    }
  }
  return subjects;
}

async function behave(answer: Answer, meta: MessageMeta): Promise<MessageFault | undefined> {
  switch (answer) {
    case 'return':
      return undefined;
    case 'retryable':
      return fault({ committed: 'no', retryable: true, message: 'try again' });
    case 'non-retryable':
      return fault({ committed: 'no', retryable: false, message: 'declined' });
    case 'throw':
      throw new Error('the Handler failed');
    case 'hang':
      await new Promise((resolve) =>
        meta.signal.addEventListener('abort', resolve, { once: true }),
      );
      return undefined;
  }
}

/** A Handler that records its start and does as the run's answer for its attempt says. */
function recordingHandler(run: Run, handler: string, observation: Observation) {
  const { running } = observation;
  return async (body: { readonly copy: string }, meta: MessageMeta) => {
    const { messageId, deliveryCount, lastAttempt } = meta;
    const at = vi.getMockedSystemTime()?.getTime() ?? 0;
    observation.starts.push({ handler, copy: body.copy, deliveryCount, lastAttempt, at });
    running.set(handler, (running.get(handler) ?? 0) + 1);
    observation.mostAtOnce = Math.max(observation.mostAtOnce, running.get(handler) ?? 0);
    try {
      return await behave(answerOf(run.seed, { handler, messageId, deliveryCount }), meta);
    } finally {
      running.set(handler, (running.get(handler) ?? 1) - 1);
    }
  };
}

/** The Commands and Subscriptions a Service declares, as a Handler map needs them. */
export type Declared = {
  readonly commands: readonly { readonly name: string }[];
  readonly subscriptions: readonly { readonly name: string }[];
};

/** The Handler map of a Service, every Handler recording as the run's answers say. */
export function handlerMapOf(run: Run, observation: Observation, declared: Declared) {
  const commandKeyOf = ({ name }: { name: string }) => `${name.toLowerCase()}V1`;
  const readers = readersOf({
    commands: Object.fromEntries(
      declared.commands.map((c) => [commandKeyOf(c), { declaration: c, reader: messageBody }]),
    ),
    subscriptions: Object.fromEntries(
      declared.subscriptions.map((s) => [s.name, { declaration: s, reader: messageBody }]),
    ),
  } as never) as unknown as Record<'commands' | 'subscriptions', Record<string, never>>;
  const implement = (reader: never, handler: string) =>
    handle(reader, recordingHandler(run, handler, observation) as never);
  return {
    commands: Object.fromEntries(
      declared.commands.map((c) => [
        commandKeyOf(c),
        implement(readers.commands[commandKeyOf(c)] as never, `${c.name}@1`),
      ]),
    ),
    subscriptions: Object.fromEntries(
      declared.subscriptions.map((s) => [
        s.name,
        implement(readers.subscriptions[s.name] as never, s.name),
      ]),
    ),
    readers,
  };
}
