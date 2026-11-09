import { joinedOf, receivedHeadersOf } from '@cf-loom/contract/internal';
import { deliveryOf, type Settlement } from '../broker/index.ts';
import type { FoundDurableConsumer } from './finding.ts';
import type { PulledMessage } from './pulled-message.ts';

/**
 * Hands one Message to its Handler with the wait NATS gives that delivery, and applies the
 * Settlement it comes back with; one without cf-loom's ids is ended, since cf-loom never published it.
 */
export async function deliver(message: PulledMessage, found: FoundDurableConsumer): Promise<void> {
  const read = receivedHeadersOf(headerEntriesOf(message));
  if (read.kind === 'missing') {
    message.term(
      joinedOf(
        read.names.map((name) => `no ${name} header`),
        'and',
      ),
    );
    return;
  }
  const { messageId, factId, headers } = read;
  const held = { messageId, factId, headers, body: message.data };
  const delivery = deliveryOf(found, held, message.deliveryCount);
  applySettlement(message, await found.durableConsumer.receive(delivery));
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
