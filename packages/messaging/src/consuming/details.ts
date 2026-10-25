import type { Command, Subscription } from '@cf-loom/contract';
import type * as core from 'zod/v4/core';
import type { BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';
import type { ConsumedFault } from './faults.ts';

/** A run as the Broker settles it, with the Fault built and how the hook told of it failed, if it did. */
export type Settled = {
  readonly settlement: Settlement;
  /** The Fault built, whether or not the hook told of it failed. */
  readonly fault: ConsumedFault | undefined;
  /** The `onServiceFault threw` line the core wrote, when the hook failed. */
  readonly hookFailure: string | undefined;
};

/** Runs a delivery through its Handler and answers how it settled. */
export type Settle = (delivery: Delivery) => Promise<Settled>;

/** Wraps a consumer's `settle` as the messaging's life allows it: run while open, left pending once closing. */
export type Received = (settle: Settle) => Settle;

/** A delivery left for redelivery without running its Handler, so with nothing reported. */
export const leftPending: Settled = {
  settlement: 'pending',
  fault: undefined,
  hookFailure: undefined,
};

/**
 * What the core's trouble report and the in-memory Broker read of a consumer beyond the Broker
 * seam: the Element it consumes, its identity, the Reader its Handler reads with, and `settle`,
 * `receive` with what it reported.
 */
export type ConsumerDetails = {
  readonly element: Subscription | Command;
  readonly identity: string;
  readonly reader: core.$ZodType;
  readonly settle: Settle;
};

const detailsByConsumer = new WeakMap<BrokerConsumer, ConsumerDetails>();

/** Keeps the details of a consumer the core built, for the trouble report and the in-memory Broker to read. */
export function registerConsumerDetails(consumer: BrokerConsumer, details: ConsumerDetails): void {
  detailsByConsumer.set(consumer, details);
}

/** The details of a consumer the core built; one it did not build is a bug, and throws. */
export function consumerDetailsOf(consumer: BrokerConsumer): ConsumerDetails {
  const details = detailsByConsumer.get(consumer);
  if (details === undefined) {
    throw new Error('a BrokerConsumer the core did not build was handed back to it');
  }
  return details;
}
