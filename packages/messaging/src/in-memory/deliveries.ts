import type { BrokerConsumer, ConsumedFault, Delivery, Settlement } from '../broker/index.ts';
import { consumedFaultLinesOf, receiveFailureLineOf } from '../consuming/index.ts';
import type { Attempt } from './attempts.ts';
import { Failures } from './failures.ts';
import { DeliveryLine } from './line.ts';
import { type PendingEntry, PendingList } from './pending.ts';
import type { PendingMessage } from './types.ts';

/** A delivery whose `receive` rejected is left for redelivery, as the Broker's `receive` says. */
const leftPending: Settlement = { kind: 'pending', fault: undefined };

/** How severe a settlement is, the most severe first. */
const bySeverity: readonly Settlement['kind'][] = ['ended', 'pending', 'acked'];

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

  /** Lines deliveries up without waiting for them; a cut drops them, and `settled()` reports it. */
  lineUp(attempts: readonly Attempt[]): void {
    for (const { consumer, delivery } of attempts) {
      this.#line.add(() => this.#attempt(consumer, delivery)).catch(() => undefined);
    }
  }

  /** Lines deliveries up and waits for them: the most severe settlement, or the cut that dropped one. */
  async lineUpTogether(attempts: readonly Attempt[]): Promise<Settlement['kind']> {
    const lined = attempts.map(({ consumer, delivery }) =>
      this.#line.add(() => this.#attempt(consumer, delivery)),
    );
    const kinds = await Promise.all(lined);
    return bySeverity.find((kind) => kinds.includes(kind)) ?? 'acked';
  }

  /** Lines every Message pending now up again, each for the consumer it is pending for, and waits for them. */
  async redeliver(): Promise<void> {
    const pending = this.#pending.entries();
    await Promise.all(pending.map((entry) => this.#line.add(() => this.#again(entry))));
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
  async #again({ consumer, delivery }: PendingEntry): Promise<void> {
    const current = this.#pending.entryFor(consumer, delivery.messageId);
    if (current === undefined) {
      return;
    }
    const next = { ...current.delivery, deliveryCount: current.delivery.deliveryCount + 1 };
    await this.#attempt(consumer, next);
  }

  async #attempt(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement['kind']> {
    const settlement = await this.#received(consumer, delivery);
    this.#apply(consumer, delivery, settlement);
    return settlement.kind;
  }

  async #received(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
    try {
      return await consumer.receive(delivery);
    } catch (cause) {
      const lines = [receiveFailureLineOf(consumer, delivery)];
      this.#failures.record({ lines, cause });
      return leftPending;
    }
  }

  /** What became of a delivery, kept in the list of pending Messages and the failures. */
  #apply(consumer: BrokerConsumer, delivery: Delivery, settlement: Settlement): void {
    switch (settlement.kind) {
      case 'acked':
        this.#pending.leave(consumer, delivery.messageId);
        return;
      case 'pending':
        this.#pending.put({ consumer, delivery });
        this.#failed(settlement.fault);
        return;
      case 'ended':
        this.#pending.leave(consumer, delivery.messageId);
        this.#failed(settlement.fault);
        return;
    }
  }

  #failed(fault: ConsumedFault | undefined): void {
    if (fault !== undefined) {
      this.#failures.record({ lines: consumedFaultLinesOf(fault), cause: fault });
    }
  }
}
