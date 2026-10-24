import type { EventSnapshot } from '@cf-loom/contract/internal';
import { definedOf, type JsonSchema, jsonSchemaOf } from '../json-schema/index.ts';
import { brokerHeadersRef } from './headers.ts';
import type { AsyncApiObject } from './objects.ts';

/** A Message Version that `publish` sends: its identity and name, the subject it travels on and its Snapshot entry. */
export type PublishedEvent = {
  readonly identity: string;
  readonly name: string;
  readonly address: string;
  readonly event: EventSnapshot;
};

/** The channel of a Message Version: its address, its Visibility and its one message. */
export function channelOf(published: PublishedEvent): AsyncApiObject {
  const { identity, address, event } = published;
  return {
    address,
    'x-cf-loom-visibility': event.visibility,
    messages: { [identity]: messageOf(published) },
  };
}

/** The operation by which the Service sends the message of a Message Version on its channel. */
export function operationOf({ identity }: PublishedEvent): AsyncApiObject {
  return {
    action: 'send',
    channel: { $ref: `#/channels/${identity}` },
    messages: [{ $ref: `#/channels/${identity}/messages/${identity}` }],
  };
}

function messageOf({ identity, name, event }: PublishedEvent): AsyncApiObject {
  return definedOf({
    name,
    title: identity,
    description: event.description === '' ? undefined : event.description,
    headers: brokerHeadersRef,
    payload: payloadOf(event),
  });
}

/**
 * The schema of the body, with `deprecated` where the Message Version is; a `$ref` is wrapped in an
 * `allOf`, since AsyncAPI ignores what sits beside a `$ref`.
 */
function payloadOf(event: EventSnapshot): JsonSchema {
  const body = jsonSchemaOf(event.body, 'draft-07');
  if (event.lifecycle !== 'deprecated') {
    return body;
  }
  return '$ref' in body ? { allOf: [body], deprecated: true } : { ...body, deprecated: true };
}
