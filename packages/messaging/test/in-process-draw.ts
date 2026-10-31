import { seededNext } from '../../contract/test/random-schemas.ts';

const eventWords = ['alpha', 'beta', 'gamma'] as const;
const subscriptionWords = ['watch', 'audit'] as const;
const commandWords = ['charge', 'refund'] as const;
const factIds = ['f1', 'f2', 'f3'] as const;
const waitLists = [['1s'], ['2s'], ['1s', '2s'], ['5s', '1s', '2s']] as const;
const maxDelivers = [1, 2, 3, 4, 'unlimited'] as const;

/** A wait a run draws, in the Duration the limits write. */
export type Wait = (typeof waitLists)[number][number];

/** What a Handler does on one attempt: acknowledge, leave for redelivery by a retryable Fault or a throw or by running past its wait, or end the Message. */
export type Answer = 'return' | 'retryable' | 'non-retryable' | 'throw' | 'hang';

/** One step of a run: a Message the Service publishes or sends, time passing, or the second Service starting to consume. */
export type Action =
  | { readonly kind: 'publish'; readonly event: number; readonly factId: string }
  | { readonly kind: 'send'; readonly command: number; readonly factId: string }
  | { readonly kind: 'advance'; readonly ms: number }
  | { readonly kind: 'consume-billing' };

/** One Durable consumer's settings as a run writes them. */
export type Settings = {
  readonly ackWait?: readonly Wait[];
  readonly maxDeliver?: number | 'unlimited';
};

/** The limits a run gives `inProcess()`. */
export type Limits = {
  readonly durableConsumerDefaults: Required<Settings>;
  readonly durableConsumers: Readonly<Record<string, Settings>>;
};

/** The part of a run that decides which Handlers there are. */
export type Shape = {
  /** For each Event of orders-service, how many of its own Subscriptions take it. */
  readonly subscriptionCounts: readonly number[];
  readonly commandCount: number;
  /** The Events of orders-service that billing-service subscribes to. */
  readonly billingEvents: readonly number[];
};

/** One draw of what a Service and a Caller may do with `inProcess()`. */
export type Run = Shape & {
  readonly seed: number;
  readonly limits: Limits;
  readonly actions: readonly Action[];
};

/** A Handler of a run: the Service it belongs to, its name, the Durable consumer the Broker plan names for it. */
export type HandlerSpec = {
  readonly service: 'orders-service' | 'billing-service';
  readonly handler: string;
  readonly durable: string;
};

/** A word with its first letter in capitals. */
export function pascalOf(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** The word an Event's name and its Subscriptions' are built from. */
export function eventWordOf(event: number): string {
  return eventWords[event] ?? '';
}

/** The word a Command's name is built from. */
export function commandWordOf(command: number): string {
  return commandWords[command] ?? '';
}

/** The words of the Subscriptions that take an Event. */
export function subscriptionWordsOf(count: number): readonly string[] {
  return subscriptionWords.slice(0, count);
}

/** Every Handler of a run in both Services, with the Durable consumer the Broker plan names for it. */
export function handlersOf(shape: Shape): readonly HandlerSpec[] {
  const specs: HandlerSpec[] = [];
  const orders = 'orders-service';
  for (const [event, count] of shape.subscriptionCounts.entries()) {
    for (const word of subscriptionWordsOf(count)) {
      const handler = `${eventWordOf(event)}${word}`;
      specs.push({ service: orders, handler, durable: `${orders}_${handler}` });
    }
  }
  for (let command = 0; command < shape.commandCount; command++) {
    const name = pascalOf(commandWordOf(command));
    specs.push({ service: orders, handler: `${name}@1`, durable: `${orders}_command_${name}_v1` });
  }
  for (const event of shape.billingEvents) {
    const handler = `${eventWordOf(event)}invoice`;
    specs.push({ service: 'billing-service', handler, durable: `billing-service_${handler}` });
  }
  return specs;
}

/** The draws of a seeded generator: a number below 1, a whole number in a range, and one of some items. */
type Draw = {
  readonly next: () => number;
  readonly int: (min: number, max: number) => number;
  readonly pick: <Item>(items: readonly Item[]) => Item;
};

function drawOf(seed: number): Draw {
  const next = seededNext(hashOf(0, `seed ${seed}`));
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
  };
}

/** Draws a run from a seed, so a failing draw can be replayed. */
export function runOf(seed: number): Run {
  const draw = drawOf(seed);
  const eventCount = draw.int(1, 3);
  const shape = {
    subscriptionCounts: Array.from({ length: eventCount }, () => draw.int(0, 2)),
    commandCount: draw.int(0, 2),
    billingEvents: billingEventsOf(eventCount, draw),
  };
  return { seed, ...shape, limits: limitsOf(shape, draw), actions: actionsOf(shape, draw) };
}

/** The Events billing-service subscribes to: some, and at least one, since a Service with no Subscription has no Group to declare. */
function billingEventsOf(eventCount: number, { next, int }: Draw): readonly number[] {
  const chosen = [...Array(eventCount).keys()].filter(() => next() < 0.6);
  return chosen.length > 0 ? chosen : [int(0, eventCount - 1)];
}

function limitsOf(shape: Shape, { next, pick }: Draw): Limits {
  const durableConsumers: Record<string, Settings> = {};
  for (const { durable } of handlersOf(shape)) {
    if (next() < 0.3) {
      durableConsumers[durable] =
        next() < 0.5 ? { ackWait: pick(waitLists) } : { maxDeliver: pick(maxDelivers) };
    }
  }
  const durableConsumerDefaults = { ackWait: pick(waitLists), maxDeliver: pick(maxDelivers) };
  return { durableConsumerDefaults, durableConsumers };
}

function actionsOf(shape: Shape, { next, int, pick }: Draw): readonly Action[] {
  const actions: Action[] = [];
  for (let step = int(3, 9); step > 0; step--) {
    const kind = next();
    if (kind < 0.15) {
      actions.push({ kind: 'advance', ms: int(100, 3_000) });
    } else if (shape.commandCount > 0 && kind < 0.4) {
      const command = int(0, shape.commandCount - 1);
      actions.push({ kind: 'send', command, factId: pick(factIds) });
    } else {
      const event = int(0, shape.subscriptionCounts.length - 1);
      actions.push({ kind: 'publish', event, factId: pick(factIds) });
    }
  }
  actions.splice(int(0, actions.length), 0, { kind: 'consume-billing' });
  return actions;
}

/** A hash of text and a seed, for answers every run draws the same. */
function hashOf(seed: number, text: string): number {
  let hash = (2_166_136_261 ^ seed) >>> 0;
  for (const character of text) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  const mixed = Math.imul(hash ^ (hash >>> 15), 2_246_822_507) >>> 0;
  return (mixed ^ (mixed >>> 13)) >>> 0;
}

const retrying = ['retryable', 'throw', 'hang'] as const;
const ending = ['return', 'non-retryable'] as const;

/** One attempt at a Message by a Handler. */
export type Attempt = {
  readonly handler: string;
  readonly messageId: string;
  readonly deliveryCount: number;
};

/** What a Handler answers on an attempt: a Message ends at an attempt that its Handler and Broker message id fix, after answers that leave it for redelivery. */
export function answerOf(seed: number, { handler, messageId, deliveryCount }: Attempt): Answer {
  const endsAt = 1 + (hashOf(seed, `${handler} ${messageId}`) % 6);
  if (deliveryCount > endsAt) {
    return 'return';
  }
  const answers = deliveryCount === endsAt ? ending : retrying;
  const chosen = hashOf(seed, `${handler} ${messageId} ${deliveryCount}`) % answers.length;
  return answers[chosen] ?? 'return';
}
