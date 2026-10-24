import {
  byCodePoint,
  isLive,
  jsonMediaType,
  nameAndVersionOf,
  prefixedSubjectOf,
  type ServiceSnapshot,
  subjectOf,
} from '@cf-loom/contract/internal';
import { defComponentsOf, type JsonSchema } from '../json-schema/index.ts';
import { channelOf, operationOf, type PublishedVersion } from './channels.ts';
import { brokerHeaders, brokerHeadersName } from './headers.ts';
import type { AsyncApiObject } from './objects.ts';

/** An AsyncAPI 3.1 document as `cf-loom asyncapi` prints it: a JSON value. */
export type AsyncApiDocument = {
  readonly asyncapi: '3.1.0';
  readonly info: { readonly title: string; readonly version: string };
  readonly defaultContentType: string;
  readonly channels: Readonly<Record<string, AsyncApiObject>>;
  readonly operations: Readonly<Record<string, AsyncApiObject>>;
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> };
};

/** The document of a Service's Events, or the line saying what of its Snapshot AsyncAPI cannot name. */
export type AsyncApiWritten =
  | { readonly kind: 'written'; readonly document: AsyncApiDocument }
  | { readonly kind: 'unnamed'; readonly line: string };

/** The AsyncAPI document of the Events a Service publishes at a version, each subject under the prefix, if one is given. */
export function asyncApiDocumentOf(
  snapshot: ServiceSnapshot,
  prefix: string | null,
  version: string,
): AsyncApiWritten {
  const published = publishedVersionsOf(snapshot, prefix);
  const defs = defComponentsOf(
    published.map(({ event }) => event.body),
    snapshot.defs,
    'draft-07',
  );
  if (defs.kind === 'unnamed') {
    return { kind: 'unnamed', line: defs.line };
  }
  const document: AsyncApiDocument = {
    asyncapi: '3.1.0',
    info: { title: snapshot.name, version },
    defaultContentType: jsonMediaType,
    channels: byIdentity(published, channelOf),
    operations: byIdentity(published, operationOf),
    components: { schemas: schemasOf(defs.schemas, published) },
  };
  return { kind: 'written', document };
}

/** The Message Versions the Service's EventPublisher publishes, Internal and Private alike, in code point order of their identity. */
function publishedVersionsOf(
  snapshot: ServiceSnapshot,
  prefix: string | null,
): readonly PublishedVersion[] {
  return Object.entries(snapshot.events)
    .filter(([, event]) => isLive(event))
    .toSorted(([left], [right]) => byCodePoint(left, right))
    .map(([identity, event]) => {
      const { name, version } = nameAndVersionOf(identity);
      const subject = subjectOf(snapshot.name, { kind: 'event', name, version });
      return { identity, name, address: prefixedSubjectOf(prefix, subject), event };
    });
}

/** What each Message Version writes, by its identity, in the order given. */
function byIdentity(
  published: readonly PublishedVersion[],
  objectOf: (publishedVersion: PublishedVersion) => AsyncApiObject,
): Readonly<Record<string, AsyncApiObject>> {
  return Object.fromEntries(
    published.map((publishedVersion) => [publishedVersion.identity, objectOf(publishedVersion)]),
  );
}

/** The recursive defs, and the broker headers where a channel is written, each in code point order of its name. */
function schemasOf(
  defs: Readonly<Record<string, JsonSchema>>,
  published: readonly PublishedVersion[],
): Readonly<Record<string, JsonSchema>> {
  const schemas = published.length === 0 ? defs : { ...defs, [brokerHeadersName]: brokerHeaders };
  return Object.fromEntries(
    Object.entries(schemas).toSorted(([left], [right]) => byCodePoint(left, right)),
  );
}
