import { z } from 'zod';
import { openEnum } from '../src/index.ts';
import { type Declarations, type Outer, outers } from './fill-outers.ts';
import type { Schema } from './fill-rows.ts';

/** A schema around a slot; `undefined` in the slot is the slot removed, `null` back means it cannot be. */
type Inner = {
  readonly name: string;
  readonly around: (slot: Schema | undefined) => Schema | null;
};

let defCount = 0;

/** An object on a cycle of its own that holds what `held` makes of itself, each use a `ref`. */
function cyclic(held: (self: () => Schema) => Record<string, Schema>): Schema {
  const def: Schema = z.object(held(() => def)).meta({ id: `c${defCount++}` });
  return def;
}

const listOf = (slot: Schema | undefined, rest: Schema[]): Schema[] =>
  slot === undefined ? rest : [slot, ...rest];
const open = () => openEnum(['a']);
const variantOf = (shape: Record<string, Schema>) => z.object({ k: z.literal('a'), ...shape });

/** Every way a schema sits inside another that a rule over walked nodes tells apart. */
const inners: readonly Inner[] = [
  {
    name: 'field',
    around: (s) => z.object(s === undefined ? { b: z.string() } : { s, b: z.string() }),
  },
  { name: 'optionBoolean', around: (s) => z.union(listOf(s, [z.boolean()]) as never) },
  {
    name: 'optionObject',
    around: (s) => z.union(listOf(s, [z.object({ a: z.string() })]) as never),
  },
  { name: 'optionOpen', around: (s) => z.union(listOf(s, [z.object({ e: open() })]) as never) },
  { name: 'optionLiteral', around: (s) => z.union(listOf(s, [z.literal('b')]) as never) },
  { name: 'nullable', around: (s) => (s === undefined ? null : s.nullable()) },
  {
    name: 'interObject',
    around: (s) => (s === undefined ? null : z.intersection(s, z.object({ k: z.number() }))),
  },
  {
    name: 'interRef',
    around: (s) =>
      s === undefined
        ? null
        : z.intersection(
            s,
            cyclic((self) => ({ a: z.lazy(self).optional() })),
          ),
  },
  {
    name: 'interUnion',
    around: (s) =>
      s === undefined ? null : z.intersection(s, z.union([z.object({ e: open() }), z.boolean()])),
  },
  {
    name: 'interOpen',
    around: (s) => (s === undefined ? null : z.intersection(z.object({ e: open() }), s)),
  },
  { name: 'key', around: (s) => (s === undefined ? null : z.record(s as never, z.string())) },
  { name: 'value', around: (s) => (s === undefined ? null : z.record(z.string(), s)) },
  { name: 'items', around: (s) => (s === undefined ? null : z.array(s)) },
  { name: 'tupleItem', around: (s) => z.tuple(listOf(s, [z.string()]).toReversed() as never) },
  {
    name: 'variantField',
    around: (s) =>
      z.discriminatedUnion('k', [
        variantOf(s === undefined ? {} : { v: s }),
        z.object({ k: z.literal('b') }),
      ]),
  },
  {
    name: 'variant',
    around: (s) =>
      z.discriminatedUnion('k', [
        z.object({ k: z.string() }),
        ...listOf(s, [z.object({ k: z.literal('b') })]),
      ] as never),
  },
  {
    name: 'defOnCycle',
    around: (s) =>
      cyclic((self) => ({ ...(s === undefined ? {} : { v: s }), next: z.lazy(self).optional() })),
  },
  {
    name: 'defHeldTwice',
    around: (slot) => {
      const def = cyclic((self) => ({
        ...(slot === undefined ? {} : { v: slot }),
        next: z.lazy(self).optional(),
      }));
      return z.object({ first: def, second: def });
    },
  },
  {
    name: 'nodelessCycle',
    around: (slot) => {
      const def: Schema = z
        .union(listOf(slot, [z.lazy(() => def)]) as never)
        .meta({ id: `n${defCount++}` });
      return def;
    },
  },
];

/** A context: a slot one or two schemas deep in an outer place. */
export type Context = {
  readonly name: string;
  readonly declare: (slot: Schema | undefined) => Declarations | null;
};

/** The contexts: every pair of inners in a body, and every other place alone and around one inner. */
export function contextsOf(): readonly Context[] {
  const [body, ...places] = outers as readonly [Outer, ...Outer[]];
  const contexts: Context[] = [];
  for (const first of inners) {
    for (const second of inners) {
      if (first.name === 'variant' && second.name === 'variant') {
        continue;
      }
      const declare = (slot: Schema | undefined) => {
        const held = second.around(slot);
        const around = held === null ? null : first.around(held);
        return around === null ? null : body.place(around);
      };
      contexts.push({ name: `body > ${first.name} > ${second.name}`, declare });
    }
  }
  for (const place of places) {
    contexts.push({
      name: place.name,
      declare: (slot) => (slot === undefined ? null : place.place(slot)),
    });
    for (const first of inners) {
      const declare = (slot: Schema | undefined) => {
        const around = first.around(slot);
        return around === null ? null : place.place(around);
      };
      contexts.push({ name: `${place.name} > ${first.name}`, declare });
    }
  }
  return contexts;
}

/** A context's declarations, none when zod refuses to build the schema around the slot. */
export function declaredIn(context: Context, slot: Schema | undefined): Declarations | null {
  try {
    return context.declare(slot);
  } catch {
    return null;
  }
}
