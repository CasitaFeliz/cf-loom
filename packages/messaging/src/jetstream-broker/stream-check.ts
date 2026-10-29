import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type JetStreamManager, type JetStreamOptions, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { ServiceStream } from '../broker/index.ts';

/** What a refusal tells whoever reads it to do, when the Broker lacks what the Service's plan lists or holds it differently. */
export const planRemedy = "apply the Service's Broker plan";

/** The Service's stream and the subjects it must hold, named as they are on the Broker, prefix included. */
export type PrefixedStream = { readonly name: string; readonly subjects: readonly string[] };

/** The Service's stream as the Broker names it, with the prefix in front of the names `connect` was told. */
export function prefixedStreamOf(
  serviceStream: ServiceStream,
  prefix: string | null,
): PrefixedStream {
  return {
    name: prefixedNameOf(prefix, serviceStream.stream),
    subjects: serviceStream.subjects.map((subject) => prefixedSubjectOf(prefix, subject)),
  };
}

/** The one JetStream manager of a connection, with the Service's options and no `$JS.API.INFO` request. */
export function managerOf(
  natsConnection: NatsConnection,
  options: JetStreamOptions | undefined,
): Promise<JetStreamManager> {
  // biome-ignore lint/style/useNamingConvention: nats.js spells the option `checkAPI`
  return jetstreamManager(natsConnection, { ...options, checkAPI: false });
}

/** What the Service's stream lacks on the Broker: nothing, the stream itself, or some of its subjects. */
export type StreamCheck =
  | { readonly kind: 'complete' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'missing-subjects'; readonly subjects: readonly string[] };

/** Whether the stream exists and holds every subject; the streams are listed unfiltered only to tell an absent stream from one missing subjects. */
export async function checkedStreamOf(
  manager: JetStreamManager,
  stream: PrefixedStream,
): Promise<StreamCheck> {
  const missing = await missingSubjectsOf(manager, stream);
  if (missing.length === 0) {
    return { kind: 'complete' };
  }
  if (!(await isNamed(manager.streams.names(), stream.name))) {
    return { kind: 'absent' };
  }
  return { kind: 'missing-subjects', subjects: missing };
}

/** The subjects the stream does not hold, as the server answers which streams hold each, so a stream made with a wildcard holds them. */
export async function missingSubjectsOf(
  manager: JetStreamManager,
  stream: PrefixedStream,
): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const subject of stream.subjects) {
    const held = await isNamed(manager.streams.names(subject), stream.name);
    if (!held) {
      missing.push(subject);
    }
  }
  return missing;
}

async function isNamed(names: AsyncIterable<string>, stream: string): Promise<boolean> {
  for await (const name of names) {
    if (name === stream) {
      return true;
    }
  }
  return false;
}
