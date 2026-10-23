import type { JetStreamOptions } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { BrokerConnection } from '../broker/index.ts';

/** The connection `messaging()` publishes, consumes and closes through, over the NATS connection the Service opened. */
export function jetStreamConnectionOf(
  nc: NatsConnection,
  _prefix: string | null,
  _options: JetStreamOptions | undefined,
): BrokerConnection {
  return {
    publish: () => Promise.resolve(),
    // TODO(#128)
    consume: () => Promise.reject(new Error('jetstream() does not consume yet')),
    close: () => nc.drain(),
  };
}
