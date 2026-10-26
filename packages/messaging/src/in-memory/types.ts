import type { Command, Event, Subscription } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { Broker, Settlement } from '../broker/index.ts';
import type { GivenHeaders } from '../sending/index.ts';

/** The body a Message Version's writer writes, what `publish` or `send` takes for it; a Provided Event's is its Reader's. */
type WrittenBodyOf<M extends Event | Command> = core.output<M['body']>;

/**
 * What `memory()` returns: a `Broker` that keeps everything in memory, serves one connection and
 * delivers one Message at a time, which a test drives and watches.
 */
export type MemoryBroker = Broker & {
  /**
   * Waits until nothing is in flight, Messages Handlers publish or send meanwhile included; rejects
   * when a Handler threw or returned a Fault, a Message was ended, an `onServiceFault` threw or deliveries were cut
   * since the last `settled()`.
   */
  readonly settled: () => Promise<void>;
  /** Every Message the Service published or sent, in the order the Broker took it, duplicates dropped. */
  readonly messages: readonly RecordedMessage[];
  /** The Messages of one Message Version among `messages`, in the same order, each body typed by it; none before the Service connects, and none for a declaration the Service does not publish or send, a Provided Event's included. */
  readonly messagesOf: <const M extends Event | Command>(
    message: M,
  ) => readonly RecordedMessage<M>[];
  /**
   * Delivers one new Message as attempt 1: an Event reaches every Subscription to it, a Command its
   * CommandHandler; resolves to the most severe settlement. Its body is typed as its Message
   * Version's writer writes it and is written back through each consumer's Reader. A Handler that
   * awaits it never settles.
   */
  readonly deliver: <const M extends Event | Command>(
    message: M,
    body: WrittenBodyOf<M>,
    meta?: DeliveryMeta,
  ) => Promise<Settlement>;
  /**
   * Delivers every pending Message again, each to the consumer it is pending for alone, as attempt
   * `deliveryCount + 1`.
   */
  readonly redeliver: () => Promise<void>;
  /** The Messages a Handler left unacknowledged, which the Broker never delivers again on its own. */
  readonly pending: readonly PendingMessage[];
};

/** A Message as the Broker took it: its subject, ids and transport headers, and its body parsed from its JSON, typed by its Message Version when it is known. */
export type RecordedMessage<M extends Event | Command = Event | Command> = {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: WrittenBodyOf<M>;
};

/** What `deliver` may set: the Fact id, random when left out; the broker message id, `<event|command>.<Name>.v<n>:<factId>` when left out, refused as a Fact id is and counted in the broker headers' bytes; the transport headers, `{}` when left out, an `undefined` one left out. */
export type DeliveryMeta = {
  readonly factId?: string;
  readonly messageId?: string;
  readonly headers?: GivenHeaders;
};

/** A Message a consumer left unacknowledged; `redeliver()` delivers it again. Its `body` is the wire JSON, for inspection. */
export type PendingMessage = {
  readonly element: Subscription | Command;
  /** `notifyOnSettled` for a Subscription, `ChargeCard@1` for a Command's Message Version. */
  readonly identity: string;
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};
