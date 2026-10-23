import type { Consumer, JsMsg } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Binding } from './binding.ts';
import { deliver } from './delivering.ts';

// biome-ignore lint/style/useNamingConvention: nats.js spells the option in snake case
const oneMessage = { max_messages: 1 };

/** Pulls one Message at a time from a durable consumer and delivers it, until `stopping` aborts or the connection ends. */
export async function pullFrom(
  binding: Binding,
  natsConnection: NatsConnection,
  stopping: AbortSignal,
): Promise<void> {
  while (!stopping.aborted && !natsConnection.isClosed() && !natsConnection.isDraining()) {
    const message = await nextOf(binding.pulled);
    if (message !== null) {
      await deliver(message, binding);
    }
  }
}

async function nextOf(pulled: Consumer): Promise<JsMsg | null> {
  const messages = await pulled.fetch(oneMessage);
  for await (const message of messages) {
    return message;
  }
  return null;
}
