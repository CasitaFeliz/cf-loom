import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type JetStreamManager, type JetStreamOptions, jetstreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import type { BrokerService } from '../broker/index.ts';

/** The Service's stream and the subjects it must hold, named as they are on the Broker, prefix included. */
export type Requirement = { readonly stream: string; readonly subjects: readonly string[] };

/** What the Broker must hold for a Service, with the prefix in front of the names `connect` was told. */
export function requirementOf(service: BrokerService, prefix: string | null): Requirement {
  return {
    stream: prefixedNameOf(prefix, service.stream),
    subjects: service.subjects.map((subject) => prefixedSubjectOf(prefix, subject)),
  };
}

/** The subjects the Service's stream does not hold, as the server answers which streams hold each, so a stream made with a wildcard holds them. */
export async function missingSubjectsOf(
  nc: NatsConnection,
  required: Requirement,
  options: JetStreamOptions | undefined,
): Promise<readonly string[]> {
  // biome-ignore lint/style/useNamingConvention: nats.js spells the option `checkAPI`
  const manager = await jetstreamManager(nc, { ...options, checkAPI: false });
  const missing: string[] = [];
  for (const subject of required.subjects) {
    const held = await isHeld(manager, required.stream, subject);
    if (!held) {
      missing.push(subject);
    }
  }
  return missing;
}

async function isHeld(
  manager: JetStreamManager,
  stream: string,
  subject: string,
): Promise<boolean> {
  for await (const name of manager.streams.names(subject)) {
    if (name === stream) {
      return true;
    }
  }
  return false;
}
