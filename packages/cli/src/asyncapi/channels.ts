import type { EventSnapshot } from '@cf-loom/contract/internal';
import { definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import { brokerHeadersRef } from './headers.ts';
import type { AsyncApiObject } from './objects.ts';

/** A Message Version the Service's EventPublisher publishes: its identity and name, the subject it travels on, the bindings of its channel and its Snapshot entry. */
export type PublishedVersion = {
  readonly identity: string;
  readonly name: string;
  readonly address: string;
  readonly bindings: AsyncApiObject | undefined;
  readonly event: EventSnapshot;
};

/** The channel of a Message Version: its address, its Visibility, its one message and its bindings, where its wire has any. */
export function channelOf(publishedVersion: PublishedVersion): AsyncApiObject {
  const { identity, address, bindings, event } = publishedVersion;
  return definedOf({
    address,
    'x-cf-loom-visibility': event.visibility,
    messages: { [identity]: messageOf(publishedVersion) },
    bindings,
  });
}

/** The operation by which the Service sends the message of a Message Version on its channel, tagged with its Group. */
export function operationOf({ identity, event }: PublishedVersion): AsyncApiObject {
  return {
    action: 'send',
    channel: { $ref: `#/channels/${identity}` },
    tags: [{ name: event.group }],
    messages: [{ $ref: `#/channels/${identity}/messages/${identity}` }],
  };
}

function messageOf({ identity, name, event }: PublishedVersion): AsyncApiObject {
  return definedOf({
    name,
    title: identity,
    description: event.description,
    headers: brokerHeadersRef,
    payload: payloadOf(event),
  });
}

/**
 * The schema of the body, with `deprecated` where the Message Version is; a bare `$ref` goes in an
 * `allOf` first, since AsyncAPI ignores what sits beside a `$ref`.
 */
function payloadOf(event: EventSnapshot): JsonSchema {
  const body = jsonSchemaOf(event.body, 'draft-07');
  if (event.lifecycle !== 'deprecated') {
    return body;
  }
  return '$ref' in body ? { allOf: [body], deprecated: true } : { ...body, deprecated: true };
}
