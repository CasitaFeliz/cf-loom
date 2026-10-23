import { receivedHeadersOf } from '@cf-loom/contract/internal';
import type { JsMsg } from '@nats-io/jetstream';
import type { BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';
import type { Binding } from './binding.ts';

const leftPending: Settlement = { kind: 'pending', fault: undefined };

/**
 * Hands one JetStream Message to its Handler and applies the Settlement it comes back with; a
 * Message without cf-loom's ids is ended, since cf-loom never published it and cannot identify it.
 */
export async function deliver(message: JsMsg, binding: Binding): Promise<void> {
  const read = receivedHeadersOf(headerEntriesOf(message));
  if (read.kind === 'missing') {
    message.term(read.names.map((name) => `no ${name} header`).join(', '));
    return;
  }
  const { messageId, factId, headers } = read;
  const { deliveryCount } = message.info;
  const delivery = { messageId, factId, deliveryCount, headers, body: message.data };
  applySettlement(message, await receivedBy(binding.consumer, delivery));
}

function headerEntriesOf(message: JsMsg): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];
  for (const [name, values] of message.headers ?? []) {
    for (const value of values) {
      entries.push([name, value]);
    }
  }
  return entries;
}

/** What `receive` settles to; one that rejects, which only an `onServiceFault` that throws causes, leaves the Message for redelivery. */
async function receivedBy(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
  try {
    return await consumer.receive(delivery);
  } catch {
    return leftPending;
  }
}

function applySettlement(message: JsMsg, settlement: Settlement): void {
  switch (settlement.kind) {
    case 'acked':
      message.ack();
      return;
    case 'ended':
      message.term();
      return;
    case 'pending':
      return;
  }
}
