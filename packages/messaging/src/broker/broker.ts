/** A broker as `connect` takes it: what an adapter returns, `jetstream()`, `memory()` or an organization's own. */
export type Broker = {
  readonly connect: (service: BrokerService) => Promise<BrokerConnection>;
};

/**
 * What `connect` tells the broker, unprefixed: the stream named after the Service and the subjects
 * of the Messages it publishes and sends, which that stream must hold.
 */
export type BrokerService = {
  readonly stream: string;
  readonly subjects: readonly string[];
};

/** One messaging's connection to a broker. */
export type BrokerConnection = {
  /** Sends one Message and resolves once the Broker has taken it, saying whether it dropped it as a duplicate. */
  readonly publish: (message: OutgoingMessage) => Promise<BrokerAck>;
  /**
   * Hands the consumers to the broker; resolves once consuming has started and rejects having
   * started nothing. Once `run.closing` aborts, or if it already has, it hands nothing more to
   * `receive`; a Message still handed over is left pending by the core.
   */
  readonly consume: (consumers: readonly BrokerConsumer[], run: ConsumeRun) => Promise<void>;
  /** Called once every `receive` has settled; ends what `consume` started and finishes applying any Settlement. */
  readonly close: () => Promise<void>;
};

/** What `consume` hands the adapter besides the consumers: the signal the core aborts when `close()` starts, and where it reports a consumer that stopped or resumed being pulled from. */
export type ConsumeRun = {
  readonly closing: AbortSignal;
  /**
   * Called once when a consumer stops being pulled from, with why, and once when its pulls are
   * answered again; never once `closing` has aborted. Returns at once; a consumer the core did not
   * build throws.
   */
  readonly troubled: (trouble: ConsumerTrouble) => void;
};

/** A consumer an adapter stopped pulling from, with why, or whose pulls are answered again. */
export type ConsumerTrouble = { readonly consumer: BrokerConsumer } & (
  | { readonly kind: 'pull-failed'; readonly cause: unknown }
  | { readonly kind: 'recovered' }
);

/** What the Broker answers a Message it took: whether it already held one with that `messageId` and dropped this one. */
export type BrokerAck = { readonly duplicate: boolean };

/** A Message as it leaves: its subject, ids, transport headers and UTF-8 JSON body, unprefixed. */
export type OutgoingMessage = {
  readonly subject: string;
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
};

/** The durable consumer of a Subscription or a Command Version whose Handler is pulled, and `receive`, which runs that Handler. */
export type BrokerConsumer = {
  readonly durable: string;
  readonly stream: string;
  readonly subject: string;
  /**
   * Runs the Handler and resolves with the Settlement to apply, even when `onServiceFault` throws
   * or rejects, which the core logs and answers `'pending'`.
   */
  readonly receive: (delivery: Delivery) => Promise<Settlement>;
};

/** One Message as an adapter hands it to `receive`: its ids, which attempt, whether the Broker will deliver it again, its transport headers and its body as received. */
export type Delivery = {
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  /** Whether this is the last delivery the Broker makes; `false` when the Broker sets no limit or the adapter cannot know. */
  readonly lastAttempt: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
};

/** What the adapter does with a delivery: acknowledge it, leave it for redelivery, or end it (JetStream `term`). */
export type Settlement = 'acked' | 'pending' | 'ended';
