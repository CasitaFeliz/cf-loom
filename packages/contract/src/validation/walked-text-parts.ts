import type { Endpoint, Guard } from '../declarations/index.ts';
import { isEndpoint } from '../declarations/index.ts';
import {
  keyedRecordsOf,
  type NotAllowed,
  type ObjectNode,
  type SchemaNode,
  type WalkedLocation,
  walkSchemas,
} from '../walker/index.ts';
import type { Failure } from './failures.ts';
import { isQueryOrHeadersPart, type ObjectPart, slotAt, writtenAt } from './parts.ts';
import { locatedSchemasOf, nodesOf, schemaSlotsAmong } from './schemas.ts';
import { textFailures } from './text-only.ts';

/** The parts of an Endpoint or a Guard that a request carries as text. */
export type TextPart = Extract<
  ObjectPart,
  'input.params' | 'input.query' | 'input.headers' | 'demands.headers' | 'demands.query'
>;

/**
 * The text parts of one Endpoint or Guard walked, each an object of its fields, or every rule of
 * `generate` they break, so the runtime reads text by the nodes `generate` accepted.
 */
export type TextNodes =
  | { readonly kind: 'valid'; readonly nodeOf: (part: TextPart) => ObjectNode | undefined }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

const endpointTextParts = ['input.params', 'input.query', 'input.headers'] as const;
const guardTextParts = ['demands.headers', 'demands.query'] as const;

/** Walks the text parts of an Endpoint or a Guard and judges them by `generate`'s text rules. */
export function textNodesOf(declaration: Endpoint | Guard): TextNodes {
  const parts = isEndpoint(declaration) ? endpointTextParts : guardTextParts;
  const owner = [isEndpoint(declaration) ? 'endpoints' : 'guards', declaration.name];
  const written = parts.map((part) => ({
    at: slotAt(owner, part),
    owner: declaration,
    part,
    value: writtenAt(declaration, part),
    role: 'snapshot' as const,
  }));
  const { slots, failures: notSchemas } = schemaSlotsAmong(written);
  const walked = walkSchemas(locatedSchemasOf(slots), () => undefined);
  const nodes = nodesOf(slots, walked);
  const queryOrHeaders = nodes.slots.filter((slot) => isQueryOrHeadersPart(slot.part));
  const [first, ...others] = [
    ...notSchemas,
    ...walked.located.flatMap(notAllowedOf),
    ...textFailures(nodes),
    ...keyedRecordsOf({ queryOrHeaders, readShapes: [] }, nodes.defs),
  ];
  if (first !== undefined) {
    return { kind: 'invalid', failures: [first, ...others] };
  }
  return { kind: 'valid', nodeOf: (part) => objectNodeOf(nodes.nodeOf(declaration, part)) };
}

function notAllowedOf({ walked }: WalkedLocation): readonly NotAllowed[] {
  return walked.kind === 'not-allowed' ? walked.failures : [];
}

function objectNodeOf(node: SchemaNode | undefined): ObjectNode | undefined {
  return node?.type === 'object' ? node : undefined;
}
