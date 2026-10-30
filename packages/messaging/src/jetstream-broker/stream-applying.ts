import { JetStreamApiCodes, type JetStreamManager, type StreamInfo } from '@nats-io/jetstream';
import { type Applied, refusedBy } from '../broker-applying/index.ts';
import { isApiError } from './api-error.ts';
import type { PlannedStream } from './settings.ts';
import { missingSubjectsOf } from './stream-check.ts';

/** Creates the stream, or gives the one that exists the subjects of the plan it does not hold and the plan's limits. */
export async function applyStream(
  manager: JetStreamManager,
  stream: PlannedStream,
): Promise<Applied> {
  try {
    const held = await infoOf(manager, stream.name);
    if (held === undefined) {
      await create(manager, stream);
    } else {
      await update(manager, stream, held);
    }
    return { kind: 'applied' };
  } catch (error) {
    return refusedBy(`The stream ${stream.name}`, error);
  }
}

async function infoOf(manager: JetStreamManager, name: string): Promise<StreamInfo | undefined> {
  try {
    return await manager.streams.info(name);
  } catch (error) {
    if (isApiError(error, JetStreamApiCodes.StreamNotFound)) {
      return undefined;
    }
    throw error;
  }
}

async function create(manager: JetStreamManager, stream: PlannedStream): Promise<void> {
  const { name, subjects, settings } = stream;
  await manager.streams.add({ ...settings, name, subjects: [...subjects] });
}

async function update(
  manager: JetStreamManager,
  stream: PlannedStream,
  held: StreamInfo,
): Promise<void> {
  const missing = await missingSubjectsOf(manager, stream);
  const subjects = [...held.config.subjects, ...missing];
  await manager.streams.update(stream.name, { ...stream.settings, subjects });
}
