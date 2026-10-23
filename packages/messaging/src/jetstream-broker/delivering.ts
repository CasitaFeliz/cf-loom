import { receivedHeadersOf } from '@cf-loom/contract/internal';
import type { JsMsg } from '@nats-io/jetstream';
import type { Delivery, Settlement } from '../broker/index.ts';
import type { Binding } from './binding.ts';

/** Hands one JetStream Message to its Handler and applies the Settlement it comes back with. */
export async function deliver(message: JsMsg, binding: Binding): Promise<void> {
  const delivery = deliveryOf(message);
  const settlement = await binding.consumer.receive(delivery);
  applySettlement(message, settlement);
}

function deliveryOf(message: JsMsg): Delivery {
  const entries: (readonly [string, string])[] = [];
  for (const [name, values] of message.headers ?? []) {
    for (const value of values) {
      entries.push([name, value]);
    }
  }
  const read = receivedHeadersOf(entries);
  if (read.kind === 'missing') {
    throw new Error('unreachable until the ids are checked');
  }
  const { messageId, factId, headers } = read;
  return {
    messageId,
    factId,
    deliveryCount: message.info.deliveryCount,
    headers,
    body: message.data,
  };
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
