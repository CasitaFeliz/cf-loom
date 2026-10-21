import { type Broker, type Messaging, messaging } from '@cf-loom/messaging';
import { contract } from './contract/index.ts';

let started: Messaging<typeof contract> | undefined;

/** Connects the Service's messaging through the Broker, once at startup, so a broker problem fails there. */
export async function startMessaging(broker: Broker): Promise<Messaging<typeof contract>> {
  started = await messaging(contract, broker);
  return started;
}

/** The Service's messaging, which its Handlers publish and send through. */
export function ordersMessaging(): Messaging<typeof contract> {
  if (started === undefined) {
    throw new Error('startMessaging() was not called');
  }
  return started;
}
