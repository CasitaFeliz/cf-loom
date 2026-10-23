import { receivedHeadersOf } from '@cf-loom/contract/internal';
import type { Settlement } from '../broker/index.ts';
import type { FoundDurable } from './finding.ts';
import { waitOf, whileWorking } from './in-progress.ts';
import type { PulledMessage } from './pulled-message.ts';

/**
 * Hands one Message to its Handler and applies the Settlement it comes back with; one whose
 * `receive` rejects is left to NATS, and one without cf-loom's ids is ended, since cf-loom never published it.
 */
export async function deliver(message: PulledMessage, durable: FoundDurable): Promise<void> {
  const read = receivedHeadersOf(headerEntriesOf(message));
  if (read.kind === 'missing') {
    message.term(read.names.map((name) => `no ${name} header`).join(', '));
    return;
  }
  const { messageId, factId, headers } = read;
  const { deliveryCount } = message;
  const delivery = { messageId, factId, deliveryCount, headers, body: message.data };
  const wait = waitOf(durable.waits, deliveryCount);
  const settlement = await whileWorking(message, wait, () =>
    durable.consumer.receive(delivery),
  ).catch(() => undefined);
  if (settlement !== undefined) {
    applySettlement(message, settlement);
  }
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
