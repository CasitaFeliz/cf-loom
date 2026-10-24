import type { WithResources } from '@cf-loom/handlers';
import type { CommandSender, EventPublisher } from '@cf-loom/messaging';
import type { contract } from './contract/index.ts';

/** What this Service's Handlers reach outside its Contract: the publisher and sender of its messaging. */
export type Resources = {
  readonly publisher: EventPublisher<typeof contract>;
  readonly sender: CommandSender<typeof contract>;
};

/** The Resources a Handler takes, picked by key from the Service's. */
export type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;
