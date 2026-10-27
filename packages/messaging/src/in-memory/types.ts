import type { BodyOf, Command, Event, ServiceContract, Subscription } from '@cf-loom/contract';
import type { Settlement } from '../broker/index.ts';
import type { Messaging } from '../messaging/index.ts';
import type { GivenHeaders } from '../sending/index.ts';

/**
 * What `memory()` resolves to: one `Messaging` that keeps everything in memory and delivers one
 * Message at a time while a test waits for `settled()`, `deliver()` or `redeliver()`, and what a
 * test drives and watches it with.
 */
export type MemoryMessaging<C extends ServiceContract> = Messaging<C> & {
  /**
   * Delivers every Message lined up, Messages Handlers publish or send meanwhile included, and
   * waits until none is left; rejects when a Handler threw or returned a Fault, a Message was
   * ended, an `onServiceFault` threw or deliveries were cut since the last `settled()`.
   */
  readonly settled: () => Promise<void>;
  /** Every Message the Service published or sent, in the order it was taken, duplicates dropped. */
  readonly messages: readonly RecordedMessage[];
  /**
   * The Messages of one Message Version among `messages`, in the same order, each body typed by it:
   * none yet for a version the Service has not published or sent. Throws for a declaration that is
   * no live version of the Service's own Events nor the Active version of one of its own
   * Commands: a Retired version, a Deprecated Command version, a Provided Event, or a declaration
   * outside the Contract.
   */
  readonly messagesOf: <const M extends Event | Command>(
    message: M,
  ) => readonly RecordedMessage<M>[];
  /**
   * Delivers the Messages already lined up, then one new Message as attempt 1, and stops there:
   * an Event reaches every Subscription to it, a Command its Message Handler; resolves to the most
   * severe settlement, what the Handlers publish or send waiting for `settled()`. Its body is typed as its Message
   * Version's writer writes it and is written back through each Durable consumer's Reader. A Handler that
   * awaits it never settles.
   */
  readonly deliver: <const M extends Event | Command>(
    message: M,
    body: BodyOf<M>,
    meta?: DeliveryMeta,
  ) => Promise<Settlement>;
  /**
   * Delivers every pending Message again, each to the Durable consumer it is pending for alone, as attempt
   * `deliveryCount + 1`, and stops there: what the Handlers publish or send waits for `settled()`.
   */
  readonly redeliver: () => Promise<void>;
  /** The Messages a Handler left unacknowledged, which `memory()` never delivers again on its own. */
  readonly pending: readonly PendingMessage[];
};

/** A Message as `memory()` took it: its subject, ids and transport headers, and its body parsed from its JSON, typed by its Message Version when it is known. */
export type RecordedMessage<M extends Event | Command = Event | Command> = {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: BodyOf<M>;
};

/** What `deliver` may set: the Fact id, random when left out; the broker message id, `<event|command>.<Name>.v<n>:<factId>` when left out, refused as a Fact id is and counted in the broker headers' bytes; the transport headers, `{}` when left out, an `undefined` one left out. */
export type DeliveryMeta = {
  readonly factId?: string;
  readonly messageId?: string;
  readonly headers?: GivenHeaders;
};

/** A Message a Durable consumer left unacknowledged; `redeliver()` delivers it again. Its `body` is the wire JSON, for inspection. */
export type PendingMessage = {
  readonly declaration: Subscription | Command;
  /** `notifyOnSettled` for a Subscription, `ChargeCard@1` for a Command's Message Version. */
  readonly name: string;
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};
