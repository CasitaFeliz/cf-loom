import type { DeliveryLimits, DurableConsumer } from '../broker/index.ts';
import { DurableConsumerLine } from './line.ts';

/** The Durable consumers one `inProcess()` holds, shared by every connection through it, found by name or by subject. */
export class HeldDurableConsumers {
  readonly #byKey = new Map<string, DurableConsumerLine>();
  readonly #bySubject = new Map<string, Set<DurableConsumerLine>>();

  /** The Durable consumers that take a subject; none for a subject no `consume` has named. */
  linesOf(subject: string): Iterable<DurableConsumerLine> {
    return this.#bySubject.get(subject) ?? [];
  }

  /** The line of a Durable consumer, created with its limits at its first `consume` and held for the life of the Broker. */
  lineFor(durableConsumer: DurableConsumer, limits: DeliveryLimits): DurableConsumerLine {
    const { stream, durable, subject } = durableConsumer;
    const key = JSON.stringify([stream, durable, subject]);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const line = new DurableConsumerLine(limits);
    this.#byKey.set(key, line);
    const lines = this.#bySubject.get(subject) ?? new Set();
    lines.add(line);
    this.#bySubject.set(subject, lines);
    return line;
  }
}
