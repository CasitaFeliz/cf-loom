import {
  afterWait,
  type DeliveryLimits,
  type DurableConsumer,
  deliveryOf,
  type HeldMessage,
  type Settlement,
} from '../broker/index.ts';
import { Fifo } from './fifo.ts';

/** One Message lined up for a Durable consumer, with how many times it has been delivered. */
type Lined = { readonly message: HeldMessage; readonly deliveryCount: number };

/** One consuming connection's hand on a Durable consumer: it takes one Message at a time, until `closing` aborts. */
type Puller = {
  readonly receive: DurableConsumer['receive'];
  readonly closing: AbortSignal;
  busy: boolean;
};

/** What a Settlement needs of the Delivery it settles: when it started, how long it waits and whether it was the last. */
type Handed = {
  readonly lined: Lined;
  readonly startedMs: number;
  readonly waitMs: number;
  readonly lastAttempt: boolean;
};

/**
 * One Durable consumer held inside the process: its Messages in the order lined up, and the
 * connections pulling from it, each handed one Message at a time; a Message left pending comes
 * again at the tail once its wait, counted from the Delivery's start, has passed, one handed back
 * comes again at the head at once, and the delivery that reaches `maxDeliver` is the last.
 */
export class DurableConsumerLine {
  readonly #limits: DeliveryLimits;
  readonly #lined = new Fifo<Lined>();
  readonly #pullers = new Set<Puller>();
  #isHandOutScheduled = false;

  constructor(limits: DeliveryLimits) {
    this.#limits = limits;
  }

  /** Lines a Message up for its first delivery, handed out on a later turn of the event loop. */
  lineUp(message: HeldMessage): void {
    this.#lined.push({ message, deliveryCount: 0 });
    this.#scheduleHandOut();
  }

  /** Adds a consuming connection's hand; once its `closing` aborts, nothing more is handed to it. */
  pull(receive: DurableConsumer['receive'], closing: AbortSignal): void {
    const puller = { receive, closing, busy: false };
    this.#pullers.add(puller);
    closing.addEventListener('abort', () => this.#pullers.delete(puller), { once: true });
    this.#scheduleHandOut();
  }

  #scheduleHandOut(): void {
    if (this.#isHandOutScheduled) {
      return;
    }
    this.#isHandOutScheduled = true;
    setImmediate(() => {
      this.#isHandOutScheduled = false;
      this.#handOut();
    });
  }

  #handOut(): void {
    for (const puller of this.#pullers) {
      if (this.#lined.length === 0) {
        return;
      }
      if (!puller.busy && !puller.closing.aborted) {
        this.#hand(puller);
      }
    }
  }

  #hand(puller: Puller): void {
    const lined = this.#lined.shift();
    if (lined === undefined) {
      return;
    }
    puller.busy = true;
    const deliveryCount = lined.deliveryCount + 1;
    const delivery = deliveryOf(this.#limits, lined.message, deliveryCount);
    const handed = {
      lined: { message: lined.message, deliveryCount },
      startedMs: performance.now(),
      waitMs: delivery.waitMs,
      lastAttempt: delivery.lastAttempt,
    };
    void puller.receive(delivery).then((settlement) => {
      puller.busy = false;
      this.#settle(handed, settlement);
      this.#scheduleHandOut();
    });
  }

  #settle(handed: Handed, settlement: Settlement): void {
    if (settlement === 'acked' || settlement === 'ended' || handed.lastAttempt) {
      return;
    }
    if (settlement === 'handed-back') {
      this.#lined.unshift(handed.lined);
      return;
    }
    const { lined, startedMs, waitMs } = handed;
    const leftMs = Math.max(0, startedMs + waitMs - performance.now());
    afterWait(
      leftMs,
      () => {
        this.#lined.push(lined);
        this.#scheduleHandOut();
      },
      'lets-process-exit',
    );
  }
}
