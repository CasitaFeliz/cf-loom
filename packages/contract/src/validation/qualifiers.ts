import type { ObjectNode, SchemaNode, TupleNode } from '../walker/index.ts';
import { canonicalJson } from '../walker/index.ts';
import { isPlainObject } from './written.ts';

/** Where in a value the judgement is, and the `defs` its schema's refs resolve through. */
type Within = {
  readonly defs: Readonly<Record<string, SchemaNode>>;
  readonly path: readonly (string | number)[];
};

/**
 * The keys of a value that its schema declares nowhere, as dotted paths, since `z.object()`
 * strips them silently and a Qualifier must hold only what its schema declares.
 */
export function undeclaredKeysOf(
  value: unknown,
  node: SchemaNode,
  defs: Within['defs'],
): readonly string[] {
  return undeclaredKeys(value, node, { defs, path: [] });
}

function undeclaredKeys(value: unknown, node: SchemaNode, within: Within): readonly string[] {
  switch (node.type) {
    case 'object':
      return objectKeys(value, node, within);
    case 'array':
      return listKeys(value, () => node.items, within);
    case 'tuple':
      return listKeys(value, (index) => tupleItemOf(node, index), within);
    case 'record':
      return recordKeys(value, node.value, within);
    case 'union':
      return unionKeys(value, node.options, within);
    case 'tagged':
      return taggedKeys(value, node, within);
    case 'allOf':
      return intersectionKeys(value, node.items, within);
    case 'ref':
      return refKeys(value, node.name, within);
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'json':
      return [];
  }
}

function objectKeys(value: unknown, node: ObjectNode, within: Within): readonly string[] {
  if (!isPlainObject(value)) {
    return [];
  }
  const extra = Object.keys(value).filter((key) => !Object.hasOwn(node.fields, key));
  const nested = Object.entries(node.fields).flatMap(([key, field]) =>
    undeclaredKeys(value[key], field.schema, deeper(within, key)),
  );
  return [...extra.map((key) => pathOf(within, key)), ...nested];
}

function listKeys(
  value: unknown,
  itemOf: (index: number) => SchemaNode | undefined,
  within: Within,
): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    const node = itemOf(index);
    return node === undefined ? [] : undeclaredKeys(item, node, deeper(within, index));
  });
}

function recordKeys(value: unknown, node: SchemaNode, within: Within): readonly string[] {
  if (!isPlainObject(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, member]) =>
    undeclaredKeys(member, node, deeper(within, key)),
  );
}

/** A value fits the option that declares most of its keys: the fewest undeclared ones stand. */
function unionKeys(
  value: unknown,
  options: readonly SchemaNode[],
  within: Within,
): readonly string[] {
  const byOption = options.map((option) => undeclaredKeys(value, option, within));
  const [closest, ...others] = byOption;
  if (closest === undefined) {
    return [];
  }
  let fewest = closest;
  for (const keys of others) {
    fewest = keys.length < fewest.length ? keys : fewest;
  }
  return fewest;
}

/** An intersection declares a key when any of its items does, so only keys no item declares stand. */
function intersectionKeys(
  value: unknown,
  items: readonly SchemaNode[],
  within: Within,
): readonly string[] {
  const byItem = items.map((item) => undeclaredKeys(value, item, within));
  const [first, ...others] = byItem;
  if (first === undefined) {
    return [];
  }
  return first.filter((key) => others.every((keys) => keys.includes(key)));
}

function taggedKeys(
  value: unknown,
  node: Extract<SchemaNode, { readonly type: 'tagged' }>,
  within: Within,
): readonly string[] {
  if (!isPlainObject(value)) {
    return [];
  }
  const variant = node.variants[canonicalJson(value[node.discriminator])];
  return variant === undefined ? [] : undeclaredKeys(value, variant, within);
}

function refKeys(value: unknown, name: string, within: Within): readonly string[] {
  const def = within.defs[name];
  return def === undefined ? [] : undeclaredKeys(value, def, within);
}

function tupleItemOf(node: TupleNode, index: number): SchemaNode | undefined {
  return node.items[index] ?? node.rest;
}

function deeper(within: Within, segment: string | number): Within {
  return { defs: within.defs, path: [...within.path, segment] };
}

function pathOf(within: Within, key: string): string {
  return [...within.path, key].join('.');
}
