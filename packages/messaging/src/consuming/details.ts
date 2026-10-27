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

/** What names a consumer's deliveries when `close` hands them back: its identity and subject. */
export type Named = { readonly identity: string; readonly subject: string };

/** Wraps a consumer's `settle` as the messaging's life allows it: run while open, left pending once closing. */
export type Received = (settle: Settle, named: Named) => Settle;

/** A delivery left for redelivery without running its Handler, so with nothing reported. */
export const leftPending: Settled = {
  settlement: 'pending',
  fault: undefined,
  hookFailure: undefined,
};

/**
 * A consumer as the core built it: the Durable consumer, Stream and subject it is pulled through,
 * the Element it consumes, its identity, the Reader its Handler reads with, and `settle`; the
 * core names a trouble report from it and `memory()` delivers through it, and a Broker is handed
 * only the `BrokerConsumer` made of it.
 */
export type CoreConsumer = {
  readonly durable: string;
  readonly stream: string;
  readonly subject: string;
  readonly element: Subscription | Command;
  readonly identity: string;
  readonly reader: core.$ZodType;
  readonly settle: Settle;
};

/** The consumer a Broker is handed: its names and `receive`, which answers the Settlement `settle` reports. */
export function brokerConsumerOf({
  durable,
  stream,
  subject,
  settle,
}: CoreConsumer): BrokerConsumer {
  const receive = async (delivery: Delivery) => (await settle(delivery)).settlement;
  return { durable, stream, subject, receive };
}
