import { type ObjectNode, type Path, refused, type SchemaNode } from '../walker/index.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import type { LocatedEndpoint } from './located.ts';
import { isObjectPart, type Part, partFieldOf, slotAt } from './parts.ts';
import { attachedGuardsOf } from './references.ts';
import type { Nodes, WalkedSlot } from './schemas.ts';
import { shapeKey } from './shapes.ts';
import { textOf } from './written.ts';

/** The parts of a request that travel as text, and a Success's headers with them. */
type TextPart = 'params' | 'query' | 'headers';

/** What one Endpoint or Guard declares for a header or query name. */
type Declared = { readonly owner: string; readonly shape: string };

/** The text part a slot's fields travel in, by the field its part names; none for the rest. */
function textPartOf(part: Part): TextPart | undefined {
  return isObjectPart(part) ? partFieldOf(part) : undefined;
}

const textTypes: readonly SchemaNode['type'][] = ['string', 'number', 'boolean', 'literal', 'enum'];

const nouns: Readonly<Record<TextPart, string>> = {
  params: 'A path param',
  query: 'A query param',
  headers: 'A header',
};

/** Every text part holds only text, judged on the walked nodes. */
export function textFailures(nodes: Nodes): readonly Failure[] {
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

/**
 * A text part is an open object of text fields; a record keyed by an enum or literal, the only
 * strict object a walk gives, refuses the query params and headers a request also carries.
 */
function partFailures(slot: WalkedSlot): readonly Failure[] {
  const part = textPartOf(slot.part);
  if (part === undefined) {
    return [];
  }
  const { at, node } = slot;
  const name = textOf(at.at(-1));
  if (node.type !== 'object') {
    return [failure(at, 'not-an-object-schema', `${name} is an object of its fields`)];
  }
  if (node.nullable === true) {
    return [failure(at, 'nullable-text', `${name} is never nullable`)];
  }
  if (node.mode === 'strict' && part !== 'params') {
    return [{ kind: 'not-allowed', at, ...refused.keyedTextRecord }];
  }
  return Object.entries(node.fields).flatMap(([field, { schema }]) => [
    ...headerNameFailures(at, part, field),
    ...fieldFailures({ at, part }, field, schema),
  ]);
}

function headerNameFailures(at: Path, part: TextPart, name: string): readonly DeclarationFailure[] {
  if (part !== 'headers' || name === name.toLowerCase()) {
    return [];
  }
  const message = `Header names are lower-case: ${name}`;
  return [failure([...at, 'fields', name], 'header-names', message)];
}

function fieldFailures(
  { at, part }: { readonly at: Path; readonly part: TextPart },
  name: string,
  schema: SchemaNode,
): readonly DeclarationFailure[] {
  const fieldAt = [...at, 'fields', name];
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
  { at, part }: { readonly at: Path; readonly part: 'headers' | 'query' },
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
