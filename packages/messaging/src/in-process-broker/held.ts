import type { DeliveryLimits, DurableConsumer } from '../broker/index.ts';
import { HeldDurableConsumer } from './line.ts';

/** The Durable consumers one `inProcess()` holds, shared by every connection through it, found by name or by subject. */
export class HeldDurableConsumers {
  readonly #byKey = new Map<string, HeldDurableConsumer>();
  readonly #bySubject = new Map<string, Set<HeldDurableConsumer>>();

  /** The held Durable consumers that take a subject; none for a subject no `consume` has named. */
  durableConsumersOf(subject: string): Iterable<HeldDurableConsumer> {
    return this.#bySubject.get(subject) ?? [];
  }

  /** The held Durable consumer a `consume` hands, created with its limits at its first `consume` and held for the life of the Broker. */
  heldFor(durableConsumer: DurableConsumer, limits: DeliveryLimits): HeldDurableConsumer {
    const { stream, durable, subject } = durableConsumer;
    const key = JSON.stringify([stream, durable, subject]);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const held = new HeldDurableConsumer(limits);
    this.#byKey.set(key, held);
    const sameSubject = this.#bySubject.get(subject) ?? new Set();
    sameSubject.add(held);
    this.#bySubject.set(subject, sameSubject);
    return held;
  }
}
