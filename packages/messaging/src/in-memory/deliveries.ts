import type { BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';
import { consumedFaultLinesOf, consumerDetailsOf, type Settled } from '../consuming/index.ts';
import type { Attempt } from './attempts.ts';
import { Failures } from './failures.ts';
import { DeliveryLine, isCut } from './line.ts';
import { PendingList } from './pending.ts';
import type { PendingMessage } from './types.ts';

/** How severe a settlement is, the most severe first. */
const bySeverity: readonly Settlement[] = ['ended', 'pending', 'acked'];

/** What a `memory()` does with its consumers: delivers to them one at a time, and keeps what became of each delivery. */
export class Deliveries {
  readonly #line: DeliveryLine;
  readonly #pending = new PendingList();
  readonly #failures = new Failures();

  constructor() {
    this.#line = new DeliveryLine((cut) =>
      this.#failures.record({ lines: [cut.message], cause: undefined }),
    );
  }

  /**
   * Lines deliveries up without waiting for them; a cut drops them, and `settled()` reports it,
   * while a delivery that fails on its own reaches the runtime, as nothing waits for it.
   */
  lineUp(attempts: readonly Attempt[]): void {
    for (const { consumer, delivery } of attempts) {
      this.#line.add(() => this.#attempt(consumer, delivery)).catch(unlessCut);
    }
  }

  /** Lines deliveries up and waits for them: the most severe settlement, or the cut that dropped one. */
  async lineUpAndWait(attempts: readonly Attempt[]): Promise<Settlement> {
    const lined = attempts.map(({ consumer, delivery }) =>
      this.#line.add(() => this.#attempt(consumer, delivery)),
    );
    const settlements = await Promise.all(lined);
    return bySeverity.find((settlement) => settlements.includes(settlement)) ?? 'acked';
  }

  /** Lines every Message pending now up again, each for the consumer it is pending for, and waits for them. */
  async redeliver(): Promise<void> {
    const pending = this.#pending.attempts();
    await Promise.all(pending.map((attempt) => this.#line.add(() => this.#again(attempt))));
  }

  /** Waits until nothing is in flight, then rejects if anything failed since the last time. */
  async settled(): Promise<void> {
    await this.#line.idle();
    this.#failures.report();
  }

  pending(): readonly PendingMessage[] {
    return this.#pending.messages();
  }

  /** A pending Message delivered as its next attempt, unless it left the list since `redeliver` was called. */
  async #again({ consumer, delivery }: Attempt): Promise<void> {
    const current = this.#pending.attemptFor(consumer, delivery.messageId);
    if (current === undefined) {
      return;
    }
    const next = { ...current.delivery, deliveryCount: current.delivery.deliveryCount + 1 };
    await this.#attempt(consumer, next);
  }

  async #attempt(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
    const settled = await consumerDetailsOf(consumer).settle(delivery);
    this.#apply(consumer, delivery, settled);
    return settled.settlement;
  }

  /** What became of a delivery, kept in the list of pending Messages and the failures. */
  #apply(consumer: BrokerConsumer, delivery: Delivery, settled: Settled): void {
    switch (settled.settlement) {
      case 'acked':
        this.#pending.leave(consumer, delivery.messageId);
        break;
      case 'pending':
        this.#pending.put({ consumer, delivery });
        break;
      case 'ended':
        this.#pending.leave(consumer, delivery.messageId);
        break;
    }
    this.#failed(settled);
  }

  /** The Fault a delivery reported, then the hook's failure, each for `settled()` to report. */
  #failed({ fault, hookFailure }: Settled): void {
    if (fault !== undefined) {
      this.#failures.record({ lines: consumedFaultLinesOf(fault), cause: fault });
    }
    if (hookFailure !== undefined) {
      this.#failures.record({ lines: [hookFailure], cause: undefined });
    }
  }
}

/** Lets a cut go, which `settled()` already reports, and rethrows anything else. */
function unlessCut(reason: unknown): void {
  if (!isCut(reason)) {
    throw reason;
  }
}
