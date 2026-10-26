import type { BrokerService } from '../broker/index.ts';
import type { PublishedVersion, SentVersion, Subjects } from './subjects.ts';

/** A Message Version the Service publishes or sends, with the subject it travels on. */
export type ServiceVersion = PublishedVersion | SentVersion;

const versionsByService = new WeakMap<BrokerService, readonly ServiceVersion[]>();

/**
 * What `connect` tells the Broker: the Service's Stream and the subjects it publishes and sends.
 * The versions behind those subjects are kept for the in-memory Broker to read.
 */
export function brokerServiceOf(subjects: Subjects): BrokerService {
  const versions = [...subjects.published, ...subjects.sent];
  const service = { stream: subjects.stream, subjects: versions.map(({ subject }) => subject) };
  versionsByService.set(service, versions);
  return service;
}

/** The Message Versions a `BrokerService` the core built lists, with their subjects; one it did not build is a bug, and throws. */
export function serviceVersionsOf(service: BrokerService): readonly ServiceVersion[] {
  const versions = versionsByService.get(service);
  if (versions === undefined) {
    throw new Error('a BrokerService the core did not build was passed to memory()');
  }
  return versions;
}
