import { type Closed, linesTextOf } from '@cf-loom/contract/internal';
import type { Broker } from '../broker/index.ts';
import { type DefaultsFields, readContainer } from '../broker-limits/index.ts';
import { inProcessConnectionOf } from './connection.ts';
import { HeldDurableConsumers } from './held.ts';
import type { InProcessBrokerLimits } from './limits.ts';
import { durableConsumerReaders } from './reading-limits.ts';

/**
 * A Broker inside the Service's process, for local runs. It holds each Durable consumer that a `messaging()`
 * connected through it consumes, from that first `consume` for as long as the Broker lives, with the limits the
 * Broker plan's names resolve to. It delivers each Message published or sent to the Durable consumers of its
 * subject, one at a time per consuming connection, and again after its wait, until the Message is acknowledged,
 * ended or delivered `maxDeliver` times. It keeps nothing once a Message settles, and nothing across a restart.
 */
export function inProcess<const Given = unknown>(
  limits: Closed<Given, InProcessBrokerLimits & DefaultsFields<Given, InProcessBrokerLimits>>,
): Broker {
  const read = readContainer(
    { durableConsumer: durableConsumerReaders },
    limits,
    'InProcessBrokerLimits',
  );
  if (read.kind === 'refused') {
    throw new Error(linesTextOf(read.lines));
  }
  const held = new HeldDurableConsumers();
  return { connect: async () => inProcessConnectionOf(held, read.limits) };
}
