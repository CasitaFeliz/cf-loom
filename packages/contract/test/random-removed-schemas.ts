import type { Defs, Field, SchemaNode } from '../src/internal/index.ts';
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

/** The names an object inherits, which a def may be named all the same. */
const inheritedNames = ['toString', 'constructor', 'valueOf', 'hasOwnProperty'] as const;

/**
 * Defs a version holds only for the fields it removes to name, each named as an object inherits
 * a member, some of the time, and the removed fields that name them: the graft copies them
 * into a Former Input whose Endpoint no longer holds them.
 */
export function droppedDefsOf(
  names: readonly string[],
  next: Next,
): { readonly defs: Defs; readonly fields: readonly [string, Field][] } {
  const dropped = inheritedNames.filter((name) => !names.includes(name) && next() < 0.4);
  const defs = dropped.map((name): [string, SchemaNode] => [
    name,
    anObject({
      p: { required: true, schema: aString },
      next: { required: false, schema: useOf(names, next) },
    }),
  ]);
  const fields = dropped.map((name): [string, Field] => [
    `dropped_${name}`,
    { required: next() < 0.5, schema: useOf([name], next) },
  ]);
  return { defs: Object.fromEntries(defs), fields };
}
