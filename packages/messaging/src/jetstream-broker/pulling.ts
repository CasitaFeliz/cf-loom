import type { Consumer, JsMsg } from '@nats-io/jetstream';
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
    const pulled = await pulledFrom(binding.pulled);
    switch (pulled.kind) {
      case 'message':
        await deliver(pulled.message, binding);
        break;
      case 'expired':
        break;
      case 'failed':
        await pause(stopping);
        break;
    }
  }
}

async function pulledFrom(pulled: Consumer): Promise<Pulled> {
  try {
    const messages = await pulled.fetch(oneMessage);
    for await (const message of messages) {
      return { kind: 'message', message };
    }
    return { kind: 'expired' };
  } catch {
    return { kind: 'failed' };
  }
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
