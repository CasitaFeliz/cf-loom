import type { ServiceStream } from '../broker/index.ts';
import type { PublishedVersion, SentVersion, Subjects } from './subjects.ts';

/** A Message Version the Service publishes or sends, with the subject it travels on. */
export type ServiceVersion = PublishedVersion | SentVersion;

/** Every Message Version the Service publishes or sends, its Events' live versions first. */
export function serviceVersionsOf(subjects: Subjects): readonly ServiceVersion[] {
  return [...subjects.published, ...subjects.sent];
}

/** What `connect` tells the Broker: the Service's Stream and the subjects it publishes and sends. */
export function serviceStreamOf(subjects: Subjects): ServiceStream {
  const versions = serviceVersionsOf(subjects);
  return { stream: subjects.stream, subjects: versions.map(({ subject }) => subject) };
}
