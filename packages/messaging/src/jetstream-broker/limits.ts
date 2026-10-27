/** The retentions NATS has, written once for the type of a stream's limits and for reading them. */
export const retentions = ['limits', 'interest', 'workqueue'] as const;

/** The storage types NATS has, written once for the type of a stream's limits and for reading them. */
export const storages = ['file', 'memory'] as const;

/** The deliver policies a Durable consumer's limits may name, written once for their type and for reading them. */
export const deliverPolicies = ['all', 'new', 'last', 'last_per_subject'] as const;

/** A length of time as limits write it: a whole number from 1 and one unit, `500ms`, `30s`, `2m`, `1h` or `7d`. */
export type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

/** A stream's settings cf-loom has no opinion on, which the organization chooses. */
export type StreamLimits = {
  /** Which Messages the stream keeps: until its limits drop them, while a Durable consumer still has to read them, or until one acknowledges them. */
  readonly retention: (typeof retentions)[number];
  /** How long the stream keeps a Message. */
  readonly maxAge: Duration | 'unlimited';
  /** How long the stream drops a Message whose broker message id it already holds. */
  readonly duplicateWindow: Duration;
  /** On how many NATS servers the stream is kept. */
  readonly replicas: number;
  /** Whether the stream is kept on disk or in memory; NATS never changes it once the stream exists. */
  readonly storage: (typeof storages)[number];
};

/** A Durable consumer's settings cf-loom has no opinion on, which the organization chooses. */
export type DurableConsumerLimits = {
  /** Where a new Durable consumer starts reading its stream; NATS never changes it once the Durable consumer exists. */
  readonly deliverPolicy: (typeof deliverPolicies)[number];
  /** How long a delivery waits for its acknowledgement before it comes again, or one wait per delivery, the last repeating. */
  readonly ackWait: Duration | readonly Duration[];
  /** How many times a Message is delivered at most. */
  readonly maxDeliver: number | 'unlimited';
  /** How many deliveries may wait for an acknowledgement at once. */
  readonly maxAckPending: number | 'unlimited';
};

/** Some of a stream's or Durable consumer's settings, each possibly `undefined`, which leaves it unset like a missing key. */
type Some<Limits> = { readonly [Name in keyof Limits]?: Limits[Name] | undefined };

/** Every setting of the plan's streams and Durable consumers, keyed by the names the plan prints, with defaults for whatever one does not set. */
export type BrokerLimits = {
  readonly streamDefaults?: Some<StreamLimits> | undefined;
  readonly durableConsumerDefaults?: Some<DurableConsumerLimits> | undefined;
  readonly streams?: Readonly<Record<string, Some<StreamLimits> | undefined>> | undefined;
  readonly durableConsumers?:
    | Readonly<Record<string, Some<DurableConsumerLimits> | undefined>>
    | undefined;
};
