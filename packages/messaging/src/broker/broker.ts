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
  /** Sends one Message and resolves once the broker has taken it. */
  readonly publish: (message: OutgoingMessage) => Promise<void>;
  /**
   * Hands the consumers to the broker; resolves once consuming has started and rejects having
   * started nothing. Once `closing` aborts, or if it already has, it hands nothing more to `receive`;
   * a Message still handed over is left pending by the core.
   */
  readonly consume: (consumers: readonly BrokerConsumer[], closing: AbortSignal) => Promise<void>;
  /** Called once every `receive` has settled; ends what `consume` started and finishes applying any Settlement. */
  readonly close: () => Promise<void>;
};

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
   * or rejects, which the core logs and answers `'pending'`; should it reject, through a bug, the
   * adapter leaves the Message for redelivery.
   */
  readonly receive: (delivery: Delivery) => Promise<Settlement>;
};

/** One Message as an adapter hands it to `receive`: its ids, which attempt, its transport headers and its body as received. */
export type Delivery = {
  readonly messageId: string;
  readonly factId: string;
  readonly deliveryCount: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
};

/** What the adapter does with a delivery: acknowledge it, leave it for redelivery, or end it (JetStream `term`). */
export type Settlement = 'acked' | 'pending' | 'ended';
