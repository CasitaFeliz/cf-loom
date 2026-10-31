import {
  afterWait,
  type DeliveryLimits,
  type DurableConsumer,
  deliveryOf,
  type HeldMessage,
  type Settlement,
  type TimedDelivery,
} from '../broker/index.ts';
import { Fifo } from './fifo.ts';

/** One Message lined up for a Durable consumer, with how many times it has been delivered. */
type Lined = { readonly message: HeldMessage; readonly deliveryCount: number };

/** One consuming connection's hand on a Durable consumer: it takes one Message at a time. */
type Puller = { readonly receive: DurableConsumer['receive']; busy: boolean };

/** A Delivery handed out, the Message as it is lined up again, and the timer of its wait. */
type Handed = {
  readonly delivery: TimedDelivery;
  readonly lined: Lined;
  isWaitOver: boolean;
  isLeftPending: boolean;
  stop: () => void;
};

const stopNothing = () => undefined;

/** Whether a Message left pending is due: both its Settlement and its wait have come. */
function isDue(handed: Handed): boolean {
  return handed.isWaitOver && handed.isLeftPending;
}

/** One Durable consumer held inside the process, with the Messages lined up for it and the connections pulling one at a time from it. */
export class HeldDurableConsumer {
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
    const puller = { receive, busy: false };
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
      if (!puller.busy) {
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
    const handed: Handed = {
      delivery,
      lined: { message: lined.message, deliveryCount },
      isWaitOver: false,
      isLeftPending: false,
      stop: stopNothing,
    };
    handed.stop = this.#timerOf(handed);
    void puller.receive(delivery).then((settlement) => {
      puller.busy = false;
      this.#settle(handed, settlement);
      this.#scheduleHandOut();
    });
  }

  /** Starts the wait of a Delivery that may come again; the last attempt has none. */
  #timerOf(handed: Handed): () => void {
    if (handed.delivery.lastAttempt) {
      return stopNothing;
    }
    const waitOver = () => {
      handed.isWaitOver = true;
      if (isDue(handed)) {
        this.#lineUpAgain(handed);
      }
    };
    return afterWait(handed.delivery.waitMs, waitOver, 'lets-process-exit');
  }

  #settle(handed: Handed, settlement: Settlement): void {
    if (handed.delivery.lastAttempt) {
      return;
    }
    switch (settlement) {
      case 'acked':
      case 'ended':
        handed.stop();
        return;
      case 'handed-back':
        handed.stop();
        this.#lined.unshift(handed.lined);
        return;
      case 'pending':
        handed.isLeftPending = true;
        if (isDue(handed)) {
          this.#lineUpAgain(handed);
        }
        return;
    }
  }

  #lineUpAgain(handed: Handed): void {
    this.#lined.push(handed.lined);
    this.#scheduleHandOut();
  }
}
