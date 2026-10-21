import { type Broker, type Messaging, messaging } from '@cf-loom/messaging';
import { contract } from './contract/index.ts';

/** Connects the Service's messaging through the Broker, so its Subscription can consume. */
export function startMessaging(broker: Broker): Promise<Messaging<typeof contract>> {
  return messaging(contract, broker);
}
