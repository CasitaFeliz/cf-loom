import type { SchemaNode } from '../src/internal/index.ts';
import { anObject, aRef, aString } from './graft-fixtures.ts';
import { inShapeOrder, type Next } from './random-draft.ts';

/** A `ref` to one of the defs named, nullable now and then. */
export function useOf(names: readonly string[], next: Next): SchemaNode {
  const name = names[Math.floor(next() * names.length)] as string;
  return next() < 0.3 ? { type: 'ref', name, nullable: true } : aRef(name);
}

/** A schema a removed Input field may have, naming defs through every kind of node the graft copies. */
export function removedSchemaOf(names: readonly string[], next: Next): SchemaNode {
  const tag = { required: true, schema: { type: 'enum', values: ['a'], open: false } } as const;
  const variants = {
    '"a"': anObject({ kind: tag, x: { required: true, schema: useOf(names, next) } }),
  };
  const shapes: readonly (() => SchemaNode)[] = [
    () => useOf(names, next),
    () => ({ type: 'union', options: [useOf(names, next), aString] }),
    () => ({ type: 'tuple', items: [useOf(names, next), aString], rest: useOf(names, next) }),
    () => ({ type: 'tuple', items: [aString, useOf(names, next)] }),
    () => ({ type: 'record', key: { type: 'string' }, value: useOf(names, next) }),
    () => ({ type: 'array', items: { type: 'array', items: useOf(names, next) } }),
    () => ({ type: 'tagged', discriminator: 'kind', variants }),
    () => ({ type: 'allOf', items: inShapeOrder([useOf(names, next), { type: 'boolean' }]) }),
    () => anObject({ a: { required: false, schema: useOf(names, next) } }),
  ];
  const shape = shapes[Math.floor(next() * shapes.length)] as () => SchemaNode;
  return shape();
}
