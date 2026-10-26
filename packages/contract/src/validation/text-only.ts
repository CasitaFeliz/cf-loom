import { reservedHeaderNames } from '../declarations/index.ts';
import {
  inFields,
  type ObjectNode,
  type Place,
  placeNameOf,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import {
  attachedGuardsOf,
  isObjectPart,
  type LocatedEndpoint,
  type Part,
  partFieldOf,
  slotAt,
  type TextIn,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import type { Nodes, WalkedSlot } from './schemas.ts';

/** What one Endpoint or Guard declares for a header or query name. */
type Declared = { readonly owner: string; readonly shape: string };

/** The text part a slot's fields travel in, by the field its part names; none for the rest. */
function textPartOf(part: Part): TextIn | undefined {
  return isObjectPart(part) ? partFieldOf(part) : undefined;
}

const textTypes: readonly SchemaNode['type'][] = ['string', 'number', 'boolean', 'enum'];

const nouns: Readonly<Record<TextIn, string>> = {
  params: 'A path param',
  query: 'A query param',
  headers: 'A header',
};

/**
 * Every rule the parts that travel as text break, judged on their walked nodes, so `generate` and
 * the runtime's startup check read text parts by the same rules.
 */
export function textPartFailures(nodes: Nodes): readonly Failure[] {
  return nodes.slots.flatMap(partFailures);
}

/** Across an Endpoint and its Guards, one header or query name has one shape. */
export function conflictFailures(
  { at, endpoint }: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const guards = attachedGuardsOf(endpoint);
  return (['headers', 'query'] as const).flatMap((part) => {
    const own = { owner: textOf(endpoint.name), node: nodes.nodeOf(endpoint, `input.${part}`) };
    const demanded = guards.map((guard) => ({
      owner: textOf(guard.name),
      node: nodes.nodeOf(guard, `demands.${part}`),
    }));
    return partConflicts([own, ...demanded], { at: slotAt(at, `input.${part}`), part });
  });
}

function partFailures(slot: WalkedSlot): readonly DeclarationFailure[] {
  const part = textPartOf(slot.part);
  if (part === undefined) {
    return [];
  }
  const { at, node } = slot;
  const name = placeNameOf(at);
  if (node.type !== 'object') {
    return [failure(at, 'not-an-object-schema', `${name} is an object of its fields`)];
  }
  if (node.nullable === true) {
    return [failure(at, 'nullable-text', `${name} is never nullable`)];
  }
  return Object.entries(node.fields).flatMap(([field, { schema }]) => [
    ...headerNameFailures(at, part, field),
    ...fieldFailures({ at, part }, field, schema),
  ]);
}

/** A lower-case RFC 9110 token: the only header names a Contract declares. */
const lowerCaseToken = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;

function headerNameFailures(at: Place, part: TextIn, name: string): readonly DeclarationFailure[] {
  if (part !== 'headers') {
    return [];
  }
  const message = headerNameMessageOf(name);
  return message === undefined ? [] : [failure(inFields(at, name), 'header-names', message)];
}

/** What is wrong with a header name: its case, its characters, or a name the host owns. */
function headerNameMessageOf(name: string): string | undefined {
  if (name !== name.toLowerCase()) {
    return `Header names are lower-case: ${name}`;
  }
  if (!lowerCaseToken.test(name)) {
    return `A header name is an RFC 9110 token: ${name}`;
  }
  if (reservedHeaderNames.includes(name)) {
    return `A header the host or cf-loom owns is reserved: ${name}`;
  }
  return undefined;
}

function fieldFailures(
  { at, part }: { readonly at: Place; readonly part: TextIn },
  name: string,
  schema: SchemaNode,
): readonly DeclarationFailure[] {
  const fieldAt = inFields(at, name);
  const items = part === 'query' && schema.type === 'array' ? schema.items : schema;
  if (schema.nullable === true || items.nullable === true) {
    return [failure(fieldAt, 'nullable-text', `${nouns[part]} is never nullable: ${name}`)];
  }
  if (textTypes.includes(items.type)) {
    return [];
  }
  const lists = part === 'query' ? ', or a list of those' : '';
  const message = `${nouns[part]} travels as text: a string, number, boolean, literal or enum${lists}: ${name}`;
  return [failure(fieldAt, 'not-text', message)];
}

function partConflicts(
  sources: readonly { readonly owner: string; readonly node: SchemaNode | undefined }[],
  { at, part }: { readonly at: Place; readonly part: 'headers' | 'query' },
): readonly DeclarationFailure[] {
  const declaredByName = new Map<string, Declared>();
  const failures: DeclarationFailure[] = [];
  for (const { owner, node } of sources.filter(hasObject)) {
    for (const [name, field] of Object.entries(node.fields)) {
      const key = part === 'headers' ? name.toLowerCase() : name;
      const shape = shapeKey(field.schema);
      const first = declaredByName.get(key);
      if (first !== undefined && first.shape !== shape) {
        const message = `${nouns[part]} has one schema across an Endpoint and its Guards: ${name} differs between ${first.owner} and ${owner}`;
        failures.push(failure(at, 'input-conflict', message));
      }
      declaredByName.set(key, first ?? { owner, shape });
    }
  }
  return failures;
}

function hasObject(source: {
  readonly owner: string;
  readonly node: SchemaNode | undefined;
}): source is { readonly owner: string; readonly node: ObjectNode } {
  return source.node?.type === 'object';
}
