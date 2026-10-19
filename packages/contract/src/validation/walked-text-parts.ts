import type { Endpoint, Guard } from '../declarations/index.ts';
import { isEndpoint } from '../declarations/index.ts';
import { type ObjectNode, walkSchemas } from '../walker/index.ts';
import type { Failure } from './failures.ts';
import { type ObjectPart, slotAt, writtenAt } from './parts.ts';
import {
  failuresAt,
  locatedSchemasOf,
  nodeLookupOf,
  nodesOf,
  schemaSlotsAmong,
} from './schemas.ts';
import { textPartFailures } from './text-only.ts';

/** The parts of an Endpoint or a Guard that a request carries as text. */
export type TextPart = Extract<
  ObjectPart,
  'input.params' | 'input.query' | 'input.headers' | 'demands.headers' | 'demands.query'
>;

/**
 * The text parts of one Endpoint or Guard walked, each an object of its fields, or every rule of
 * `generate` they break, so the runtime reads text by the nodes `generate` accepted.
 */
export type WalkedTextParts =
  | { readonly kind: 'valid'; readonly nodeOf: (part: TextPart) => ObjectNode | undefined }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

const endpointTextParts = ['input.params', 'input.query', 'input.headers'] as const;
const guardTextParts = ['demands.headers', 'demands.query'] as const;

/** Walks the text parts of an Endpoint or a Guard and judges them by `generate`'s text rules. */
export function walkedTextPartsOf(declaration: Endpoint | Guard): WalkedTextParts {
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
  const [first, ...others] = [
    ...notSchemas,
    ...walked.located.flatMap(failuresAt),
    ...textPartFailures(nodes),
  ];
  if (first !== undefined) {
    return { kind: 'invalid', failures: [first, ...others] };
  }
  const nodeOf = nodeLookupOf(nodes);
  return { kind: 'valid', nodeOf: (part) => nodeOf(declaration, part) };
}
