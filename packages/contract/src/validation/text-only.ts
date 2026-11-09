import { joinedOf } from '../lines/index.ts';
import {
  type FieldOf,
  inFields,
  isWhole,
  type ObjectOutline,
  type Outline,
  type Place,
  placeNameOf,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import { isTextValue, sharedTextOf, textOfValue, textTravel } from '../wire/index.ts';
import {
  attachedGuardsOf,
  isObjectPart,
  isPlainObject,
  type LocatedEndpoint,
  partFieldOf,
  slotAt,
  type TextIn,
  textOf,
  writtenTextOf,
} from '../written/index.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { headerNameFailures } from './header-names.ts';
import type { Nodes, OutlinedSlot } from './schemas.ts';

/** Where a text part's field sits, and which part carries it. */
type Located = { readonly at: Place; readonly part: TextIn };

/** A field of a text part, with the values the part's own examples give it. */
type TextField = {
  readonly name: string;
  readonly schema: Outline;
  readonly partExamples: readonly unknown[];
};

/** What one Endpoint or Guard declares for a header or query name. */
type Declared = { readonly owner: string; readonly shape: string };

const textTypes: readonly SchemaNode['type'][] = ['string', 'number', 'boolean', 'enum'];

const nouns: Readonly<Record<TextIn, string>> = {
  params: 'A path param',
  query: 'A query param',
  headers: 'A header',
};

/**
 * Every rule the parts that travel as text break, judged on their outlines: a field's kind whatever
 * lies inside it, its values only when its schema is whole, so `generate` and the runtime's startup
 * check read text parts by the same rules.
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

function partFailures(slot: OutlinedSlot): readonly DeclarationFailure[] {
  const { at, node, part } = slot;
  if (!isObjectPart(part)) {
    return [];
  }
  const textIn = partFieldOf(part);
  const name = placeNameOf(at);
  if (node.type !== undefined && node.type !== 'object') {
    return [failure(at, 'not-an-object-schema', `${name} is an object of its fields`)];
  }
  if (node.nullable === true) {
    return [failure(at, 'nullable-text', `${name} is never nullable`)];
  }
  if (node.type === undefined) {
    return [];
  }
  const examplesByField = partExamplesByField(node);
  return Object.entries(node.fields).flatMap(([field, { schema }]) => {
    const partExamples = examplesByField.get(field) ?? [];
    return [
      ...headerNameFailures({ at, part, textIn }, field),
      ...fieldFailures({ at, part: textIn }, { name: field, schema, partExamples }),
    ];
  });
}

/**
 * The values each field takes in the part's own examples, read once over each example's entries;
 * only a part walked whole has its examples parsed, so only its are read.
 */
function partExamplesByField(part: Outline): ReadonlyMap<string, readonly unknown[]> {
  const byField = new Map<string, unknown[]>();
  const examples = isWhole(part) ? (part.examples ?? []) : [];
  for (const example of examples.filter(isPlainObject)) {
    for (const [field, value] of Object.entries(example)) {
      const values = byField.get(field);
      if (values === undefined) {
        byField.set(field, [value]);
      } else {
        values.push(value);
      }
    }
  }
  return byField;
}

/**
 * A field's kind is judged whatever lies inside it, since a fix inside changes no kind: a field of
 * an object or of a part that is nullable is no text, and one whose kind is not yet built is not
 * judged. The values it takes are judged only when its schema is whole.
 */
function fieldFailures(
  { at, part }: Located,
  { name, schema, partExamples }: TextField,
): readonly DeclarationFailure[] {
  const fieldAt = inFields(at, name);
  const items = part === 'query' && schema.type === 'array' ? schema.items : schema;
  if (schema.nullable === true || items.nullable === true) {
    return [failure(fieldAt, 'nullable-text', `${nouns[part]} is never nullable: ${name}`)];
  }
  if (items.type === undefined) {
    return [];
  }
  if (textTypes.includes(items.type)) {
    return isWhole(schema)
      ? valueFailures({ at: fieldAt, part }, { name, schema, partExamples })
      : [];
  }
  const lists = part === 'query' ? ', or a list of those' : '';
  const message = `${nouns[part]} travels as text: a string, number, boolean, literal or enum${lists}: ${name}`;
  return [failure(fieldAt, 'not-text', message)];
}

/** What a whole text field takes as values: its enum's shared texts and the values no part can carry. */
function valueFailures(
  { at, part }: Located,
  { name, schema, partExamples }: TextField & { readonly schema: SchemaNode },
): readonly DeclarationFailure[] {
  const items = part === 'query' && schema.type === 'array' ? schema.items : schema;
  const place = { at, part };
  return [
    ...sharedTextFailures(place, name, items),
    ...unsendableTextFailures(place, name, valuesOf(schema, items, partExamples)),
  ];
}

/**
 * A text part's enum whose values travel as one text: the received text reads back as the first,
 * so the other could never arrive.
 */
function sharedTextFailures(
  { at, part }: Located,
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

/**
 * Every value `generate` knows a text part's field takes: its enum's values and its examples, and
 * the values the part's own examples give it.
 */
function valuesOf(
  schema: SchemaNode,
  items: SchemaNode,
  partExamples: readonly unknown[],
): readonly unknown[] {
  const examples = [...(schema.examples ?? []), ...(items.examples ?? []), ...partExamples];
  return [...(items.type === 'enum' ? items.values : []), ...examples.flat()];
}

/**
 * A text part's field holding a value, of its enum or an example, whose text its part cannot
 * carry: no Caller can send it and no Outcome holding it is ever valid.
 */
function unsendableTextFailures(
  { at, part }: Located,
  name: string,
  values: readonly unknown[],
): readonly DeclarationFailure[] {
  const { isCarried, travelsAs } = textTravel[part];
  const distinct = [...new Set(values.filter(isTextValue))];
  const unsendable = distinct.filter((value) => !isCarried(textOfValue(value)));
  if (unsendable.length === 0) {
    return [];
  }
  const written = joinedOf(unsendable.map(writtenTextOf), 'and');
  const message = `${nouns[part]}'s values each travel as ${travelsAs}: ${name} has ${written}`;
  return [failure(at, 'unsendable-text', message)];
}

function partConflicts(
  sources: readonly { readonly owner: string; readonly node: Outline | undefined }[],
  { at, part }: { readonly at: Place; readonly part: 'headers' | 'query' },
): readonly DeclarationFailure[] {
  const declaredByName = new Map<string, Declared>();
  const failures: DeclarationFailure[] = [];
  for (const { owner, node } of sources.filter(hasObject)) {
    for (const [name, field] of Object.entries(node.fields).filter(isWholeField)) {
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

/** Whether a field's schema is whole, so its shape can be compared. */
function isWholeField(entry: [string, FieldOf<Outline>]): entry is [string, FieldOf<SchemaNode>] {
  return isWhole(entry[1].schema);
}

function hasObject(source: {
  readonly owner: string;
  readonly node: Outline | undefined;
}): source is { readonly owner: string; readonly node: ObjectOutline } {
  return source.node?.type === 'object';
}
