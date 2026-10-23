import type { Consumer, ConsumerMessages, JsMsg } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { Binding } from './binding.ts';
import { deliver } from './delivering.ts';

// biome-ignore lint/style/useNamingConvention: nats.js spells the option in snake case
const oneMessage = { max_messages: 1 };

/** How long a durable consumer waits before it pulls again after a pull failed, as when its durable consumer was deleted. */
const retryPauseMs = 1_000;

type Pulled =
  | { readonly kind: 'message'; readonly message: JsMsg }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * Pulls one Message at a time from a durable consumer and delivers it, until `stopping` aborts or the
 * connection ends; a pull that fails is tried again after a pause, silently.
 */
export async function pullFrom(
  binding: Binding,
  natsConnection: NatsConnection,
  stopping: AbortSignal,
): Promise<void> {
  while (!stopping.aborted && !natsConnection.isClosed() && !natsConnection.isDraining()) {
    const pulled = await pulledFrom(binding.pulled, stopping);
    switch (pulled.kind) {
      case 'message':
        await deliveredOrHandedBack(pulled.message, binding, stopping);
        break;
      case 'expired':
        break;
      case 'failed':
        await pause(stopping);
        break;
    }
  }
}

async function pulledFrom(pulled: Consumer, stopping: AbortSignal): Promise<Pulled> {
  try {
    const messages = await pulled.fetch(oneMessage);
    return await firstOf(messages, stopping);
  } catch {
    return { kind: 'failed' };
  }
}

/** The first Message of a pull, which is stopped at once when `stopping` aborts, so NATS delivers it nothing more. */
async function firstOf(messages: ConsumerMessages, stopping: AbortSignal): Promise<Pulled> {
  const stop = () => messages.stop();
  stopping.addEventListener('abort', stop);
  if (stopping.aborted) {
    stop();
  }
  try {
    for await (const message of messages) {
      return { kind: 'message', message };
    }
    return { kind: 'expired' };
  } finally {
    stopping.removeEventListener('abort', stop);
  }
}

/** A Message that was already on its way when pulling stopped goes back to NATS for another process, not to a Handler. */
async function deliveredOrHandedBack(
  message: JsMsg,
  binding: Binding,
  stopping: AbortSignal,
): Promise<void> {
  if (stopping.aborted) {
    message.nak();
    return;
  }
  await deliver(message, binding);
}

/** Waits the retry pause, or less when `stopping` aborts; its timer and listener never outlive it. */
function pause(stopping: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      stopping.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, retryPauseMs);
    stopping.addEventListener('abort', wake);
  });
}
