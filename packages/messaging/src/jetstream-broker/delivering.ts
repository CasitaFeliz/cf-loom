import { receivedHeadersOf } from '@cf-loom/contract/internal';
import type { Settlement } from '../broker/index.ts';
import type { FoundDurable } from './finding.ts';
import type { PulledMessage } from './pulled-message.ts';
import { waitOf } from './waits.ts';

/**
 * Hands one Message to its Handler with the wait NATS gives that delivery, and applies the
 * Settlement it comes back with; one without cf-loom's ids is ended, since cf-loom never published it.
 */
export async function deliver(message: PulledMessage, durable: FoundDurable): Promise<void> {
  const read = receivedHeadersOf(headerEntriesOf(message));
  if (read.kind === 'missing') {
    message.term(read.names.map((name) => `no ${name} header`).join(', '));
    return;
  }
  const { messageId, factId, headers } = read;
  const { deliveryCount } = message;
  const lastAttempt = isLastDelivery(durable.maxDeliver, deliveryCount);
  const waitMs = waitOf(durable.waits, deliveryCount);
  const delivered = { messageId, factId, deliveryCount, lastAttempt, waitMs };
  const delivery = { ...delivered, headers, body: message.data };
  applySettlement(message, await durable.durableConsumer.receive(delivery));
}

/** Whether NATS delivers no more after this delivery: a limit set, and reached. */
function isLastDelivery(maxDeliver: number, deliveryCount: number): boolean {
  return maxDeliver > 0 && deliveryCount >= maxDeliver;
}

function headerEntriesOf(message: PulledMessage): readonly (readonly [string, string])[] {
  const entries: (readonly [string, string])[] = [];
  for (const [name, values] of message.headers ?? []) {
    for (const value of values) {
      entries.push([name, value]);
    }
  }
  return entries;
}

function applySettlement(message: PulledMessage, settlement: Settlement): void {
  switch (settlement) {
    case 'acked':
      message.ack();
      return;
    case 'ended':
      message.term();
      return;
    case 'pending':
      return;
    case 'handed-back':
      message.nak();
      return;
  }
}
