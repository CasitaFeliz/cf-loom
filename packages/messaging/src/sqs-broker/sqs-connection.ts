import type { BrokerConnection } from '../broker/index.ts';

/** The connection `messaging()` publishes, consumes and closes through, over the clients the Service gave. */
export function sqsConnectionOf(): BrokerConnection {
  return {
    publish: () => Promise.reject(new Error('publish is not written yet')),
    consume: () => Promise.reject(new Error('consume is not written yet')),
    close: () => Promise.resolve(),
  };
}
