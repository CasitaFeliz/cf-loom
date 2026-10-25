import { type ConsumerConfig, JetStreamApiCodes, type JetStreamManager } from '@nats-io/jetstream';
import { type Applied, isApiError, refusedBy } from './applied.ts';
import type { DurableSettings } from './durable-shape.ts';
import type { PlannedDurable } from './settings.ts';

type Held = 'no-stream' | 'no-durable' | 'held';

/** Creates the pull durable consumer, or updates the one that exists, refusing one whose stream does not exist yet. */
export async function applyDurable(
  manager: JetStreamManager,
  durable: PlannedDurable,
): Promise<Applied> {
  try {
    return await createOrUpdate(manager, durable);
  } catch (error) {
    return refusedBy(`The durable consumer ${durable.name}`, error);
  }
}

async function createOrUpdate(
  manager: JetStreamManager,
  durable: PlannedDurable,
): Promise<Applied> {
  const { name, stream } = durable;
  const settings = natsSettingsOf(durable.settings);
  switch (await heldOf(manager, durable)) {
    case 'no-stream':
      return {
        kind: 'refused',
        message: `The durable consumer ${name} reads the stream ${stream}, which does not exist yet: apply its Service's plan first`,
      };
    case 'no-durable':
      await manager.consumers.add(stream, settings);
      return { kind: 'applied' };
    case 'held':
      await manager.consumers.update(stream, name, settings);
      return { kind: 'applied' };
  }
}

/** nats.js types its optional settings without `undefined`, yet an update it is given a key as `undefined` for writes over what the durable consumer holds: the one way through its typed API to clear a setting. */
function natsSettingsOf(settings: DurableSettings): Partial<ConsumerConfig> {
  return settings as unknown as Partial<ConsumerConfig>;
}

async function heldOf(manager: JetStreamManager, durable: PlannedDurable): Promise<Held> {
  try {
    await manager.consumers.info(durable.stream, durable.name);
    return 'held';
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      return 'no-stream';
    }
    if (isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
      return 'no-durable';
    }
    throw error;
  }
}
