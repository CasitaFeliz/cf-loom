import { type ConsumerConfig, JetStreamApiCodes, type JetStreamManager } from '@nats-io/jetstream';
import { type Applied, refusedBy } from '../broker-applying/index.ts';
import { isApiError } from './api-error.ts';
import type { DurableConsumerSettings } from './durable-consumer-shape.ts';
import type { PlannedDurableConsumer } from './settings.ts';

type Held = 'no-stream' | 'no-durable-consumer' | 'held';

/** Creates the Durable consumer as a pull consumer, or updates the one that exists, refusing one whose stream does not exist yet. */
export async function applyDurableConsumer(
  manager: JetStreamManager,
  planned: PlannedDurableConsumer,
): Promise<Applied> {
  try {
    return await createOrUpdate(manager, planned);
  } catch (error) {
    return refusedBy(`The Durable consumer ${planned.name}`, error);
  }
}

async function createOrUpdate(
  manager: JetStreamManager,
  planned: PlannedDurableConsumer,
): Promise<Applied> {
  const { name, stream } = planned;
  const settings = natsSettingsOf(planned.settings);
  switch (await heldOf(manager, planned)) {
    case 'no-stream':
      return {
        kind: 'refused',
        message: `The Durable consumer ${name} reads the stream ${stream}, which does not exist yet: apply its Service's plan first`,
      };
    case 'no-durable-consumer':
      await manager.consumers.add(stream, settings);
      return { kind: 'applied' };
    case 'held':
      await manager.consumers.update(stream, name, settings);
      return { kind: 'applied' };
  }
}

/** nats.js types its optional settings without `undefined`, yet its `update` sends a key given as `undefined` as cleared: the one way through its typed API to clear a setting. */
function natsSettingsOf(settings: DurableConsumerSettings): Partial<ConsumerConfig> {
  return settings as unknown as Partial<ConsumerConfig>;
}

async function heldOf(manager: JetStreamManager, planned: PlannedDurableConsumer): Promise<Held> {
  try {
    await manager.consumers.info(planned.stream, planned.name);
    return 'held';
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      return 'no-stream';
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      return 'no-durable-consumer';
    }
    throw error;
  }
}
