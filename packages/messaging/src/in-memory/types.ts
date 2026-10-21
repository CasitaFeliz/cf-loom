import type { Command, Event, Subscription } from '@cf-loom/contract';
import type { Broker, Settlement } from '../broker/index.ts';

/**
 * What `memory()` returns: a `Broker` that keeps everything in memory, serves one connection and
 * delivers one Message at a time, which a test drives and watches.
 */
export type MemoryBroker = Broker & {
  /**
   * Waits until nothing is in flight, Messages Handlers publish or send meanwhile included; rejects
   * when a Handler threw, a Message was ended or a chain was cut since the last `settled()`.
   */
  readonly settled: () => Promise<void>;
  /** Every Message the Service published or sent, in the order the Broker took it, duplicates dropped. */
  readonly messages: readonly RecordedMessage[];
  /**
   * Delivers one new Message as attempt 1: an Event reaches every Subscription to it, a Command its
   * CommandHandler; resolves to the most severe settlement. A Handler that awaits it never settles.
   */
  readonly deliver: (
    message: Event | Command,
    body: unknown,
    meta?: DeliveryMeta,
  ) => Promise<Settlement['kind']>;
  /**
   * Delivers every pending Message again, each to the consumer it is pending for alone, as attempt
   * `deliveryCount + 1`.
   */
  readonly redeliver: () => Promise<void>;
  /** The Messages a Handler left unacknowledged, which the Broker never delivers again on its own. */
  readonly pending: readonly PendingMessage[];
};

/** A Message as the Broker took it: its subject, ids and transport headers, and its body parsed from its JSON. */
export type RecordedMessage = {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

/** What `deliver` may set: the Fact id, random when left out; the broker message id, `<Name>.v<n>:<factId>` when left out; the transport headers, `{}` when left out. */
export type DeliveryMeta = {
  readonly factId?: string;
  readonly messageId?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

/** A Message a consumer left unacknowledged; `redeliver()` delivers it again. Its `body` is the wire JSON, for inspection. */
export type PendingMessage = {
  readonly element: Subscription | Command;
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};
