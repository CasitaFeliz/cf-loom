import {
  inFields,
  type ObjectNode,
  type Place,
  placeNameOf,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import {
  isHeaderText,
  isQueryText,
  isSegmentText,
  isTextValue,
  sharedTextOf,
  textOfValue,
  textTravelsAs,
} from '../wire/index.ts';
import {
  attachedGuardsOf,
  isObjectPart,
  type LocatedEndpoint,
  partFieldOf,
  slotAt,
  type TextIn,
  textOf,
  writtenTextOf,
} from '../written/index.ts';
import { listOf } from './closed-values.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { headerNameFailures } from './header-names.ts';
import type { Nodes, WalkedSlot } from './schemas.ts';

/** What one Endpoint or Guard declares for a header or query name. */
type Declared = { readonly owner: string; readonly shape: string };

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
  const { at, node, part } = slot;
  if (!isObjectPart(part)) {
    return [];
  }
  const textIn = partFieldOf(part);
  const name = placeNameOf(at);
  if (node.type !== 'object') {
    return [failure(at, 'not-an-object-schema', `${name} is an object of its fields`)];
  }
  if (node.nullable === true) {
    return [failure(at, 'nullable-text', `${name} is never nullable`)];
  }
  return Object.entries(node.fields).flatMap(([field, { schema }]) => [
    ...headerNameFailures({ at, part, textIn }, field),
    ...fieldFailures({ at, part: textIn }, field, schema),
  ]);
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
    const place = { at: fieldAt, part };
    return [
      ...sharedTextFailures(place, name, items),
      ...unsendableTextFailures(place, name, items),
    ];
  }
  const lists = part === 'query' ? ', or a list of those' : '';
  const message = `${nouns[part]} travels as text: a string, number, boolean, literal or enum${lists}: ${name}`;
  return [failure(fieldAt, 'not-text', message)];
}

/**
 * A text part's enum whose values travel as one text: the received text reads back as the first,
 * so the other could never arrive.
 */
function sharedTextFailures(
  { at, part }: { readonly at: Place; readonly part: TextIn },
  name: string,
  node: SchemaNode,
): readonly DeclarationFailure[] {
  const shared = node.type === 'enum' ? sharedTextOf(node.values) : undefined;
  if (shared === undefined) {
    return [];
  }
  const [first, second] = shared.map(writtenTextOf);
  const message = `${nouns[part]}'s values each have a text of their own: ${name} has ${first} and ${second}`;
  return [failure(at, 'shared-text', message)];
}

/** What each text part carries: the check the runtime sends by. */
const isCarriedIn: Readonly<Record<TextIn, (text: string) => boolean>> = {
  params: isSegmentText,
  query: isQueryText,
  headers: isHeaderText,
};

/**
 * A text part's enum holding a value whose text its part cannot carry: no Caller can send it and
 * no Outcome holding it is ever valid.
 */
function unsendableTextFailures(
  { at, part }: { readonly at: Place; readonly part: TextIn },
  name: string,
  node: SchemaNode,
): readonly DeclarationFailure[] {
  const unsendable =
    node.type === 'enum'
      ? node.values.filter(isTextValue).filter((value) => !isCarriedIn[part](textOfValue(value)))
      : [];
  if (unsendable.length === 0) {
    return [];
  }
  const values = listOf(unsendable.map(writtenTextOf), 'and');
  const message = `${nouns[part]}'s values each travel as ${textTravelsAs[part]}: ${name} has ${values}`;
  return [failure(at, 'unsendable-text', message)];
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
