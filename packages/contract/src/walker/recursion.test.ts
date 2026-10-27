import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import {
  reachedDefsOf,
  refusalsIn,
  type SchemaNode,
  siteTextOf,
  walkSchemas,
} from '../internal/index.ts';

/** The place of a schema walked on its own: the export of the name given, with no steps. */
function placeAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

function walkBody(schema: core.$ZodType) {
  return refusalsOf(walkSchemas([{ at: placeAt('body'), schema }], () => undefined));
}

function walkedTo(value: unknown) {
  return { kind: 'walked', value };
}

function refused(failures: readonly { readonly at: string; readonly construct: string }[]) {
  const named = failures.map((failure) => ({ kind: 'not-allowed', ...failure }));
  return { kind: 'not-allowed', failures: named };
}

/** The site each refusal of each walked schema sits at: a schema the walk remembers keeps the place it was first walked at. */
function refusalSitesOf({ located }: ReturnType<typeof walkSchemas>) {
  return located.map(({ walked }) =>
    walked.kind === 'walked' ? [] : refusalsIn(walked.tree).map(({ site }) => siteTextOf(site)),
  );
}

const unnamedCycle = { construct: 'a cycle without .meta({ id })', instead: '.meta({ id })' };
const dateRefused = { construct: 'z.date()', instead: 'z.iso.datetime()' };

const categoryDef = {
  type: 'object',
  fields: {
    name: { required: true, schema: { type: 'string' } },
    children: {
      required: true,
      schema: { type: 'array', items: { type: 'ref', name: 'category' } },
    },
  },
} as const;

const wrapperIdInstead = '.meta({ id }) on the schema inside';

describe('walkSchemas: recursion', () => {
  test('a cycle through a getter is written once under defs and referenced by ref', () => {
    const category = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'category' })],
      defs: { category: categoryDef },
    });
  });

  test('a cycle through z.lazy() is written once under defs and referenced by ref', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(category) }))
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'category' })],
      defs: { category: categoryDef },
    });
  });

  test('an annotated z.lazy() around a lazy def with an id is a ref carrying the annotation', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .lazy(() =>
        z.object({
          name: z.string(),
          children: z.array(z.lazy(() => category).describe('A child')),
        }),
      )
      .meta({ id: 'category' });
    const child = { type: 'ref', name: 'category', description: 'A child' };

    expect(walkBody(category)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'category' })],
      defs: {
        category: {
          ...categoryDef,
          fields: {
            ...categoryDef.fields,
            children: { required: true, schema: { type: 'array', items: child } },
          },
        },
      },
    });
  });

  test('two ids on one chain of lazies give a def and an alias def that refs it', () => {
    type Node = { c: Node[] };
    const inner: z.ZodType<Node> = z
      .lazy(() => z.object({ c: z.array(outer) }))
      .meta({ id: 'inner' });
    const outer: z.ZodType<Node> = z.lazy(() => inner).meta({ id: 'outer' });

    expect(walkBody(outer)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'outer' })],
      defs: {
        inner: {
          type: 'object',
          fields: {
            c: { required: true, schema: { type: 'array', items: { type: 'ref', name: 'outer' } } },
          },
        },
        outer: { type: 'ref', name: 'inner' },
      },
    });
  });

  describe('a def is never nullable: .nullable() belongs to a use', () => {
    const nullableDefOf = (id: string) => ({
      construct: `.meta({ id: "${id}" }) on a schema that admits null`,
      instead: '.meta({ id }) on the schema inside, and .nullable() on each use',
    });

    test('a plain def used with .nullable() writes the def plain and each such ref nullable', () => {
      const node: z.ZodType = z
        .object({ label: z.string(), next: z.lazy(() => node).nullable() })
        .meta({ id: 'tree' });

      const written = walkBody(z.object({ root: node.nullable(), other: node }));

      expect(written.defs['tree']?.nullable).toBeUndefined();
      expect(written.located).toEqual([
        walkedTo({
          type: 'object',
          fields: {
            root: { required: true, schema: { type: 'ref', name: 'tree', nullable: true } },
            other: { required: true, schema: { type: 'ref', name: 'tree' } },
          },
        }),
      ]);
    });

    test('an alias def of a plain def is written plain, nullable only on its nullable uses', () => {
      const inner: z.ZodType = z
        .object({
          label: z.string(),
          get next() {
            return alias.nullable();
          },
        })
        .meta({ id: 'inner' });
      const alias: z.ZodType = z.lazy(() => inner).meta({ id: 'alias' });

      const written = walkBody(z.object({ root: alias }));

      expect(written.defs).toEqual({
        inner: {
          type: 'object',
          fields: {
            label: { required: true, schema: { type: 'string' } },
            next: { required: true, schema: { type: 'ref', name: 'alias', nullable: true } },
          },
        },
        alias: { type: 'ref', name: 'inner' },
      });
    });

    const onDef: z.ZodType = z
      .object({ label: z.string(), next: z.lazy(() => onDef) })
      .nullable()
      .meta({ id: 'tree' });
    const throughLazy: z.ZodType = z
      .lazy(() => z.object({ next: throughLazy }).nullable())
      .meta({ id: 'tree' });
    const nullableInner: z.ZodType = z
      .object({
        get next() {
          return aliasOfNullable;
        },
      })
      .nullable()
      .meta({ id: 'tree' });
    const aliasOfNullable: z.ZodType = z.lazy(() => nullableInner).meta({ id: 'alias' });
    const intersected: z.ZodType = z
      .intersection(
        z
          .object({
            get next() {
              return intersected;
            },
          })
          .nullable(),
        z.object({ label: z.string() }).nullable(),
      )
      .meta({ id: 'tree' });

    test.each([
      ['on .nullable()', onDef],
      ['through z.lazy() to a .nullable()', throughLazy],
      ['on an intersection of nullable objects', intersected],
    ])('an id %s is refused where the schema is used, and writes no def', (_name, schema) => {
      const written = walkBody(z.object({ root: schema }));

      expect(written).toEqual({
        located: [refused([{ at: 'root', ...nullableDefOf('tree') }])],
        defs: {},
      });
    });

    const aliasOfLazy: z.ZodType = z.lazy(() => nullableLazy).meta({ id: 'a' });
    const nullableLazy: z.ZodType = z
      .lazy(() =>
        z
          .object({
            get next() {
              return aliasOfLazy;
            },
          })
          .nullable(),
      )
      .meta({ id: 'b' });

    test.each([
      ['the alias', aliasOfNullable, 'tree'],
      ['the nullable def', nullableInner, 'tree'],
      ['the alias of a lazy nullable', aliasOfLazy, 'b'],
      ['a lazy nullable def', nullableLazy, 'b'],
    ])(
      'a cycle through an alias of a nullable def, entered at %s, reports its refusal and writes no def',
      (_name, schema, id) => {
        const written = walkBody(z.object({ root: schema }));

        expect(written).toEqual({
          located: [refused([{ at: 'root', ...nullableDefOf(id) }])],
          defs: {},
        });
      },
    );
  });

  describe('a cycle through z.lazy(), unions and intersections alone', () => {
    const nodelessCycle = {
      construct: 'a cycle through z.lazy(), unions and intersections alone, which zod cannot parse',
    };
    const nullable: z.ZodType = z.lazy(() => nullable.nullable()).meta({ id: 'nullable' });
    const described: z.ZodType = z
      .lazy(() => described)
      .meta({ id: 'described', description: 'Itself' });

    test('a z.lazy() of itself with an id fails where the walk enters it and writes no def', () => {
      const node: z.ZodType = z.lazy(() => node).meta({ id: 'node' });

      const walked = walkBody(node);

      expect(walked).toEqual({
        located: [refused([{ at: '', ...nodelessCycle }])],
        defs: {},
      });
    });

    test.each([
      ['nullable', nullable],
      ['described', described],
    ])('a %s z.lazy() of itself with an id fails the same', (_name, schema) => {
      const walked = walkBody(schema);

      expect(walked).toEqual({
        located: [refused([{ at: '', ...nodelessCycle }])],
        defs: {},
      });
    });

    describe('two ids that are only lazies of each other', () => {
      const first: z.ZodType = z.lazy(() => second).meta({ id: 'first' });
      const second: z.ZodType = z.lazy(() => first).meta({ id: 'second' });

      test.each([
        ['first', first],
        ['second', second],
      ])('entered at the %s fail where the walk enters them and write no def', (_name, schema) => {
        const walked = walkBody(schema);

        expect(walked).toEqual({
          located: [refused([{ at: '', ...nodelessCycle }])],
          defs: {},
        });
      });

      test('used at two locations, the other id of the cycle is the failure walked at the first, at both', () => {
        const walked = walkSchemas(
          [
            { at: placeAt('body'), schema: first },
            { at: placeAt('success'), schema: second },
          ],
          () => undefined,
        );

        const failure = { at: '', ...nodelessCycle };
        expect(refusalsOf(walked)).toEqual({
          located: [refused([failure]), refused([failure])],
          defs: {},
        });
        expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
      });
    });

    test('a cycle entered at a lazy with no id fails the same', () => {
      const entry: z.ZodType = z.lazy(() => named);
      const named: z.ZodType = z.lazy(() => entry).meta({ id: 'named' });

      const walked = walkBody(entry);

      expect(walked).toEqual({
        located: [refused([{ at: '', ...nodelessCycle }])],
        defs: {},
      });
    });

    test('a cycle used at two locations is the failure walked at the first, at both', () => {
      const node: z.ZodType = z.lazy(() => node).meta({ id: 'node' });

      const walked = walkSchemas(
        [
          { at: placeAt('body'), schema: node },
          { at: placeAt('success'), schema: z.array(node) },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked)).toEqual({
        located: [refused([{ at: '', ...nodelessCycle }]), refused([{ at: '', ...nodelessCycle }])],
        defs: {},
      });
      expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
    });

    test('a z.lazy() of itself as a discriminated union variant fails and does not throw', () => {
      const variant: z.ZodType = z.lazy(() => variant);
      const union = z.discriminatedUnion('kind', [variant as unknown as z.ZodObject]);

      const walked = walkBody(union);

      expect(walked).toEqual({
        located: [
          refused([
            {
              at: '<|0>',
              construct: 'a discriminated union variant that is not an object',
            },
            { at: '<|0>', ...unnamedCycle },
          ]),
        ],
        defs: {},
      });
    });

    test('the id of a refused cycle stays taken, so another schema with it is a duplicate', () => {
      const taken: z.ZodType = z.union([z.lazy(() => taken), z.string()]).meta({ id: 'shared' });
      const category = z
        .object({
          get children() {
            return z.array(category);
          },
        })
        .meta({ id: 'shared' });

      const walked = walkSchemas(
        [
          { at: placeAt('body'), schema: taken },
          { at: placeAt('success'), schema: category },
        ],
        () => undefined,
      );

      const duplicate = { at: '', construct: 'two schemas with .meta({ id: "shared" })' };
      expect(refusalsOf(walked)).toEqual({
        located: [refused([{ at: '', ...nodelessCycle }]), refused([duplicate])],
        defs: {},
      });
      expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.success']]);
    });

    test('a def dropped with one failure keeps it when a later failure drops the group around it', () => {
      const root: z.ZodType = z
        .object({
          get next(): z.ZodType {
            return open;
          },
          placedAt: z.date(),
        })
        .meta({ id: 'root' });
      const open: z.ZodType = z
        .union([z.lazy(() => open), z.lazy(() => root), z.array(z.lazy(() => held))])
        .meta({ id: 'open' });
      const held: z.ZodType = z
        .object({
          get back(): z.ZodType {
            return open;
          },
        })
        .meta({ id: 'held' });

      const walked = walkSchemas(
        [
          { at: placeAt('body'), schema: root },
          { at: placeAt('success'), schema: held },
        ],
        () => undefined,
      );

      const cycle = { at: 'next', ...nodelessCycle };
      const date = { at: 'placedAt', ...dateRefused };
      expect(refusalsOf(walked)).toEqual({
        located: [refused([cycle, date]), refused([cycle])],
        defs: {},
      });
      expect(refusalSitesOf(walked)).toEqual([['exports.body', 'exports.body'], ['exports.body']]);
    });

    describe('with unions and intersections on the cycle', () => {
      const refusedAtBody = {
        located: [refused([{ at: '', ...nodelessCycle }])],
        defs: {},
      };
      const anObject = z.object({ a: z.string() });
      const selfFirst: z.ZodType = z
        .union([z.lazy(() => selfFirst), z.string()])
        .meta({ id: 'selfFirst' });
      const selfLast: z.ZodType = z
        .union([z.string(), z.lazy(() => selfLast)])
        .meta({ id: 'selfLast' });
      const nullableOption: z.ZodType = z
        .union([z.lazy(() => nullableOption).nullable(), z.string()])
        .meta({ id: 'nullableOption' });
      const describedOption: z.ZodType = z
        .union([z.lazy(() => describedOption).describe('Itself'), z.string()])
        .meta({ id: 'describedOption' });
      const nullableUnion: z.ZodType = z
        .union([z.lazy(() => nullableUnion), z.string()])
        .nullable()
        .meta({ id: 'nullableUnion' });
      const intersected: z.ZodType = z
        .intersection(
          anObject,
          z.lazy(() => intersected),
        )
        .meta({ id: 'intersected' });
      const nullableIntersected: z.ZodType = z
        .intersection(anObject, z.lazy(() => nullableIntersected).nullable())
        .meta({ id: 'nullableIntersected' });
      const orSelf: z.ZodType = z
        .string()
        .or(z.lazy(() => orSelf))
        .meta({ id: 'orSelf' });
      const andSelf: z.ZodType = anObject.and(z.lazy(() => andSelf)).meta({ id: 'andSelf' });
      const nestedUnion: z.ZodType = z
        .union([z.union([z.lazy(() => nestedUnion), z.number()]), z.string()])
        .meta({ id: 'nestedUnion' });
      const intersectedOption: z.ZodType = z
        .union([
          z.intersection(
            anObject,
            z.lazy(() => intersectedOption),
          ),
          z.string(),
        ])
        .meta({ id: 'intersectedOption' });
      const innerId: z.ZodType = z.union([
        z.lazy(() => innerId).meta({ id: 'innerId' }),
        z.string(),
      ]);

      test.each([
        ['first', selfFirst],
        ['last', selfLast],
      ])('a union with itself as its %s option fails where the walk enters it', (_, schema) => {
        expect(walkBody(schema)).toEqual(refusedAtBody);
      });

      test.each([
        ['a nullable self option', nullableOption],
        ['a described self option', describedOption],
        ['a nullable union of itself', nullableUnion],
      ])('%s fails the same', (_, schema) => {
        expect(walkBody(schema)).toEqual(refusedAtBody);
      });

      test.each([
        ['an intersection with itself', intersected],
        ['an intersection with a nullable self', nullableIntersected],
        ['.or() with itself', orSelf],
        ['.and() with itself', andSelf],
      ])('%s fails the same', (_, schema) => {
        expect(walkBody(schema)).toEqual(refusedAtBody);
      });

      test.each([
        ['a nested union', nestedUnion],
        ['an intersection that is a union option', intersectedOption],
      ])('the self option inside %s fails the same', (_, schema) => {
        expect(walkBody(schema)).toEqual(refusedAtBody);
      });

      describe('two unions that are options of each other', () => {
        const unionA: z.ZodType = z
          .union([z.lazy(() => unionB), z.string()])
          .meta({ id: 'unionA' });
        const unionB: z.ZodType = z
          .union([z.lazy(() => unionA), z.number()])
          .meta({ id: 'unionB' });
        const refsA: z.ZodType = z.union([z.lazy(() => refsB)]).meta({ id: 'refsA' });
        const refsB: z.ZodType = z.union([z.lazy(() => refsA)]).meta({ id: 'refsB' });

        test.each([
          ['first', unionA],
          ['second', unionB],
        ])('entered at the %s fail where the walk enters them and write no def', (_, schema) => {
          expect(walkBody(schema)).toEqual(refusedAtBody);
        });

        test.each([
          ['first', refsA],
          ['second', refsB],
        ])('made of refs only, entered at the %s, they fail the same', (_, schema) => {
          expect(walkBody(schema)).toEqual(refusedAtBody);
        });
      });

      test('an id only on the lazy of the cycle fails where that lazy sits', () => {
        const walked = walkBody(innerId);

        expect(walked).toEqual({
          located: [refused([{ at: '<|0>', ...nodelessCycle }])],
          defs: {},
        });
      });

      describe('a def of the group that is off the unparsable cycle', () => {
        const listed: z.ZodType = z
          .union([z.lazy(() => numbered), z.array(z.lazy(() => holder))])
          .meta({ id: 'listed' });
        const numbered: z.ZodType = z
          .union([z.lazy(() => listed), z.number()])
          .meta({ id: 'numbered' });
        const holder: z.ZodType = z
          .object({
            get field(): z.ZodType {
              return listed;
            },
          })
          .meta({ id: 'holder' });

        test('used at a second location is the failure walked at the first, with no def', () => {
          const walked = walkSchemas(
            [
              { at: placeAt('body'), schema: numbered },
              { at: placeAt('success'), schema: holder },
            ],
            () => undefined,
          );

          const failure = { at: '', ...nodelessCycle };
          expect(refusalsOf(walked)).toEqual({
            located: [refused([failure]), refused([failure])],
            defs: {},
          });
          expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
        });
      });
    });
  });

  describe('a cycle with a node on it other than a union or an intersection', () => {
    const listing: z.ZodType = z
      .union([z.string(), z.array(z.lazy(() => listing))])
      .meta({ id: 'listing' });
    const itself: z.ZodType = z
      .object({
        get self(): z.ZodType {
          return itself;
        },
      })
      .meta({ id: 'itself' });
    const tupled: z.ZodType = z.tuple([z.lazy(() => tupled)]).meta({ id: 'tupled' });
    const recorded: z.ZodType = z
      .record(
        z.string(),
        z.lazy(() => recorded),
      )
      .meta({ id: 'recorded' });

    test('a union whose recursive option is an array of itself is a def', () => {
      expect(walkBody(listing)).toEqual({
        located: [walkedTo({ type: 'ref', name: 'listing' })],
        defs: {
          listing: {
            type: 'union',
            options: [
              { type: 'string' },
              { type: 'array', items: { type: 'ref', name: 'listing' } },
            ],
          },
        },
      });
    });

    test('recursion through a required field alone is still a def', () => {
      expect(walkBody(itself)).toEqual({
        located: [walkedTo({ type: 'ref', name: 'itself' })],
        defs: {
          itself: {
            type: 'object',
            fields: { self: { required: true, schema: { type: 'ref', name: 'itself' } } },
          },
        },
      });
    });

    test('a record of itself is still a def', () => {
      expect(walkBody(recorded)).toEqual({
        located: [walkedTo({ type: 'ref', name: 'recorded' })],
        defs: {
          recorded: {
            type: 'record',
            key: { type: 'string' },
            value: { type: 'ref', name: 'recorded' },
          },
        },
      });
    });

    test('a tuple of itself is still a def', () => {
      expect(walkBody(tupled)).toEqual({
        located: [walkedTo({ type: 'ref', name: 'tupled' })],
        defs: { tupled: { type: 'tuple', items: [{ type: 'ref', name: 'tupled' }] } },
      });
    });
  });

  test('a def whose own walk fails drops the defs open below it, so every use is the one failure', () => {
    const outer: z.ZodType = z
      .object({
        get inner(): z.ZodType {
          return inner;
        },
        placedAt: z.date(),
      })
      .meta({ id: 'outer' });
    const inner: z.ZodType = z.array(z.lazy(() => outer)).meta({ id: 'inner' });

    const walked = walkSchemas(
      [
        { at: placeAt('body'), schema: outer },
        { at: placeAt('success'), schema: inner },
      ],
      () => undefined,
    );

    const failure = { at: 'placedAt', ...dateRefused };
    expect(refusalsOf(walked)).toEqual({
      located: [refused([failure]), refused([failure])],
      defs: {},
    });
    expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
  });

  test('defs dropped with their group are not walked again by a later use', () => {
    const count = 4;
    const steps: z.ZodType[] = [];
    const nextOf = (index: number) => steps[(index + 1) % (count + 1)];
    for (let index = 0; index <= count; index++) {
      const own = index === 0 ? { placedAt: z.date() } : {};
      const step = z.object({
        ...own,
        get a() {
          return nextOf(index);
        },
        get b() {
          return nextOf(index);
        },
      });
      steps.push(step.meta({ id: `step${index}` }));
    }

    let asked = 0;
    const walked = walkSchemas(
      [
        { at: placeAt('body'), schema: steps[0]! },
        { at: placeAt('success'), schema: steps[1]! },
      ],
      () => {
        asked++;
        return undefined;
      },
    );

    const failure = { at: 'placedAt', ...dateRefused };
    expect(refusalsOf(walked)).toEqual({
      located: [refused([failure]), refused([failure])],
      defs: {},
    });
    expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
    expect(asked).toBe(13);
  });

  test('a cyclic schema used at two locations is one def', () => {
    const category = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'category' });

    const walked = walkSchemas(
      [
        { at: placeAt('body'), schema: category },
        { at: placeAt('success'), schema: z.array(category) },
      ],
      () => undefined,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        walkedTo({ type: 'ref', name: 'category' }),
        walkedTo({ type: 'array', items: { type: 'ref', name: 'category' } }),
      ],
      defs: { category: categoryDef },
    });
  });

  test('a cycle without an id fails where it closes', () => {
    const category = z.object({
      get children() {
        return z.array(category);
      },
    });

    expect(walkBody(category)).toEqual({
      located: [refused([{ at: 'children[]', ...unnamedCycle }])],
      defs: {},
    });
  });

  test('a cycle without an id used at two locations is the failure walked at the first, at both', () => {
    const category = z.object({
      get children() {
        return z.array(category);
      },
    });

    const walked = walkSchemas(
      [
        { at: placeAt('body'), schema: category },
        { at: placeAt('success'), schema: z.array(category) },
      ],
      () => undefined,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        refused([{ at: 'children[]', ...unnamedCycle }]),
        refused([{ at: 'children[]', ...unnamedCycle }]),
      ],
      defs: {},
    });
    expect(refusalSitesOf(walked)).toEqual([['exports.body'], ['exports.body']]);
  });

  test('two cyclic schemas with one id fail', () => {
    const category = z
      .object({
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'node' });
    const folder = z
      .object({
        get folders() {
          return z.array(folder);
        },
      })
      .meta({ id: 'node' });

    const walked = walkSchemas(
      [
        { at: placeAt('body'), schema: category },
        { at: placeAt('success'), schema: folder },
      ],
      () => undefined,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        walkedTo({ type: 'ref', name: 'node' }),
        refused([{ at: '', construct: 'two schemas with .meta({ id: "node" })' }]),
      ],
      defs: {
        node: {
          type: 'object',
          fields: {
            children: {
              required: true,
              schema: { type: 'array', items: { type: 'ref', name: 'node' } },
            },
          },
        },
      },
    });
    expect(refusalSitesOf(walked)).toEqual([[], ['exports.success']]);
  });

  describe('a refusal never stops the walk', () => {
    test.each([
      ['.default()', (tree: z.ZodType) => z.array(tree).default([]), '.default()'],
      ['.prefault()', (tree: z.ZodType) => z.array(tree).prefault([]), '.prefault()'],
      ['.catch()', (tree: z.ZodType) => z.array(tree).catch([]), '.catch()'],
      ['.readonly()', (tree: z.ZodType) => z.array(tree).readonly(), '.readonly()'],
      [
        'z.preprocess()',
        (tree: z.ZodType) => z.preprocess((value) => value, tree),
        '.preprocess()',
      ],
      ['z.looseRecord()', (tree: z.ZodType) => z.looseRecord(z.string(), tree), 'z.looseRecord()'],
      ['z.xor()', (tree: z.ZodType) => z.xor([tree, z.string()]), 'z.xor()'],
      ['z.map()', (tree: z.ZodType) => z.map(z.string(), tree), 'z.map()'],
      ['z.set()', (tree: z.ZodType) => z.set(tree), 'z.set()'],
      ['z.promise()', (tree: z.ZodType) => z.promise(tree), 'z.promise()'],
      ['z.success()', (tree: z.ZodType) => z.success(tree), 'z.success()'],
      [
        'z.function()',
        (tree: z.ZodType) => z.function({ input: [tree], output: z.string() }),
        'z.function()',
      ],
    ])(
      'a recursive schema with %s on its cycle fails with that construct alone',
      (_name, through, construct) => {
        const tree: z.ZodType = z
          .object({
            get children() {
              return through(tree);
            },
          })
          .meta({ id: 'tree' });

        expect(walkBody(tree)).toEqual({
          located: [refused([{ at: 'children', construct }])],
          defs: {},
        });
      },
    );

    test('a recursive schema with a __proto__ field on its cycle fails with that field alone', () => {
      const tree: z.ZodType = z
        .object({
          ['__proto__']: z.lazy(() => tree),
        })
        .meta({ id: 'tree' });

      const failure = {
        at: '__proto__',
        construct: 'a field named __proto__ (zod drops it when parsing)',
      };
      expect(walkBody(tree)).toEqual({ located: [refused([failure])], defs: {} });
    });

    test('a two-member cycle broken by .catch() reports .catch() alone', () => {
      const parent: z.ZodType = z
        .object({
          get child() {
            return child;
          },
        })
        .meta({ id: 'parent' });
      const child: z.ZodType = z
        .object({
          get parent() {
            return parent.catch(undefined as never);
          },
        })
        .meta({ id: 'child' });

      const failure = {
        at: 'child.parent',
        construct: '.catch()',
      };
      expect(walkBody(parent)).toEqual({ located: [refused([failure])], defs: {} });
    });
  });

  describe('an id on a field wrapper', () => {
    const leaf: z.ZodType = z
      .object({
        get up() {
          return z.array(leaf);
        },
      })
      .meta({ id: 'leaf' });
    const leafDef = {
      type: 'object',
      fields: {
        up: { required: true, schema: { type: 'array', items: { type: 'ref', name: 'leaf' } } },
      },
    };

    function wrapperFailure(construct: string) {
      return { at: 'next', construct, instead: wrapperIdInstead };
    }

    test('an id on .optional() fails, and the schema inside is walked', () => {
      const order = z.object({ next: leaf.optional().meta({ id: 'next' }) });

      expect(walkBody(order)).toEqual({
        located: [refused([wrapperFailure('.meta({ id }) on .optional()')])],
        defs: { leaf: leafDef },
      });
    });

    test('an id on .nonoptional() fails, and the schema inside is walked', () => {
      const order = z.object({ next: leaf.optional().nonoptional().meta({ id: 'next' }) });

      expect(walkBody(order)).toEqual({
        located: [refused([wrapperFailure('.meta({ id }) on .nonoptional()')])],
        defs: { leaf: leafDef },
      });
    });

    test('an id on the .optional() inside .nonoptional() fails the same', () => {
      const order = z.object({ next: leaf.optional().meta({ id: 'next' }).nonoptional() });

      expect(walkBody(order)).toEqual({
        located: [refused([wrapperFailure('.meta({ id }) on .optional()')])],
        defs: { leaf: leafDef },
      });
    });

    test('the wrapper’s other .meta() keys fail beside its id', () => {
      const order = z.object({ next: leaf.optional().meta({ id: 'next', title: 'Next' }) });

      expect(walkBody(order)).toEqual({
        located: [
          refused([
            { at: 'next', construct: '.meta({ title })' },
            wrapperFailure('.meta({ id }) on .optional()'),
          ]),
        ],
        defs: { leaf: leafDef },
      });
    });

    test('the wrapper id and the unnamed cycle inside are both reported', () => {
      const node: z.ZodType = z.object({
        get next() {
          return node.optional().meta({ id: 'node' });
        },
      });

      expect(walkBody(node)).toEqual({
        located: [
          refused([
            wrapperFailure('.meta({ id }) on .optional()'),
            { at: 'next', ...unnamedCycle },
          ]),
        ],
        defs: {},
      });
    });
  });

  describe('the grammar of an id', () => {
    function recursiveWith(id: string): z.ZodType {
      const node: z.ZodType = z
        .object({
          get children() {
            return z.array(node);
          },
        })
        .meta({ id });
      return node;
    }

    test.each(['123', '__proto__', 'tree-node', 'ñandú', 'Tree', ''])(
      'the id %j on a recursive schema fails, and no def is written',
      (id) => {
        const walked = walkBody(recursiveWith(id));

        const [location] = walked.located;
        expect(location).toMatchObject({
          kind: 'not-allowed',
          failures: expect.arrayContaining([
            {
              kind: 'not-allowed',
              at: '',
              construct: `.meta({ id: ${JSON.stringify(id)} })`,
              instead: 'a camelCase name',
            },
          ]),
        });
        expect(walked.defs).toEqual({});
      },
    );

    test('a recursive schema walks to a def exactly when its id is camelCase', () => {
      const alphabet = ['a', 'Z', '1', '-', '_', 'ñ'];
      const ones = alphabet;
      const twos = ones.flatMap((first) => alphabet.map((last) => first + last));
      const threes = twos.flatMap((first) => alphabet.map((last) => first + last));
      const ids = [...ones, ...twos, ...threes];

      const defined = ids.filter((id) => Object.hasOwn(walkBody(recursiveWith(id)).defs, id));

      expect(ids).toHaveLength(258);
      expect(defined).toEqual(ids.filter((id) => /^[a-z][a-zA-Z0-9]*$/.test(id)));
    });
  });

  describe('an id on a schema that lies on no cycle', () => {
    function acyclicAt(at: string, id: string) {
      return {
        at,
        construct: `.meta({ id: ${JSON.stringify(id)} }) on a schema that lies on no cycle`,
        instead: '.meta({ id }) only on a recursive schema',
      };
    }

    const money = z.object({ amount: z.int() }).meta({ id: 'money' });

    test('two schemas with one id each fail as acyclic, and none as a duplicate', () => {
      const order = z.object({
        paid: z.object({ amount: z.int() }).meta({ id: 'money' }),
        due: z.object({ amount: z.int() }).meta({ id: 'money' }),
      });

      expect(walkBody(order)).toEqual({
        located: [refused([acyclicAt('paid', 'money'), acyclicAt('due', 'money')])],
        defs: {},
      });
    });

    test('one schema used at two fields fails at both', () => {
      const order = z.object({ paid: money, due: money });

      expect(walkBody(order)).toEqual({
        located: [refused([acyclicAt('paid', 'money'), acyclicAt('due', 'money')])],
        defs: {},
      });
    });

    test('it fails with what else is not allowed in the schema', () => {
      const dated = z.object({ at: z.date() }).meta({ id: 'dated' });

      const failures = [acyclicAt('', 'dated'), { at: 'at', ...dateRefused }];
      expect(walkBody(dated)).toEqual({ located: [refused(failures)], defs: {} });
    });

    test('it fails beside a recursive schema that has the same id', () => {
      const node: z.ZodType = z
        .object({
          get children() {
            return z.array(node);
          },
        })
        .meta({ id: 'node' });

      const walked = walkSchemas(
        [
          { at: placeAt('body'), schema: node },
          { at: placeAt('success'), schema: z.string().meta({ id: 'node' }) },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked).located).toEqual([
        walkedTo({ type: 'ref', name: 'node' }),
        refused([acyclicAt('', 'node')]),
      ]);
      expect(refusalSitesOf(walked)).toEqual([[], ['exports.success']]);
      expect(Object.keys(walked.defs)).toEqual(['node']);
    });

    test('it fails on a leaf inside a recursive schema', () => {
      const tree: z.ZodType = z
        .object({
          label: z.string().meta({ id: 'label' }),
          get children() {
            return z.array(tree);
          },
        })
        .meta({ id: 'tree' });

      const walked = walkBody(tree);

      const failure = acyclicAt('label', 'label');
      expect(walked.located).toEqual([refused([failure])]);
    });

    test('it fails on an alias outside the cycle it points at, and the cycle is still a def', () => {
      const tree: z.ZodType = z
        .object({
          get children() {
            return z.array(tree);
          },
        })
        .meta({ id: 'tree' });
      const alias = z.lazy(() => tree).meta({ id: 'alias' });

      const walked = walkSchemas([{ at: placeAt('body'), schema: alias }], () => undefined);

      expect(refusalsOf(walked).located).toEqual([refused([acyclicAt('', 'alias')])]);
      expect(Object.keys(walked.defs)).toEqual(['tree']);
    });
  });

  describe('mutual recursion with an id on one schema', () => {
    const department = z
      .object({
        get teams() {
          return z.array(team);
        },
      })
      .meta({ id: 'department' });
    const team = z.object({
      get department() {
        return department;
      },
    });

    const teamNode = {
      type: 'object',
      fields: { department: { required: true, schema: { type: 'ref', name: 'department' } } },
    } as const;
    const departmentDef = {
      type: 'object',
      fields: { teams: { required: true, schema: { type: 'array', items: teamNode } } },
    } as const;
    const expected = {
      located: [walkedTo(teamNode), walkedTo({ type: 'ref', name: 'department' })],
      defs: { department: departmentDef },
    };

    test('entering at the schema without the id gives the def and refs', () => {
      const walked = walkSchemas(
        [
          { at: placeAt('team'), schema: team },
          { at: placeAt('department'), schema: department },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked)).toEqual(expected);
    });

    test('entering at the schema with the id gives the same nodes and defs', () => {
      const walked = walkSchemas(
        [
          { at: placeAt('department'), schema: department },
          { at: placeAt('team'), schema: team },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked)).toEqual({ ...expected, located: [...expected.located].reverse() });
    });
  });

  describe('mutual recursion without an id', () => {
    const department = z.object({
      get teams() {
        return z.array(team);
      },
    });
    const team = z.object({
      get department() {
        return department;
      },
    });

    test.each([
      ['department', department, 'teams[].department'],
      ['team', team, 'department.teams[]'],
    ])('entered at the %s, the cycle fails', (_name, schema, at) => {
      expect(walkBody(schema)).toEqual({
        located: [refused([{ at, ...unnamedCycle }])],
        defs: {},
      });
    });
  });

  test('every schema with an id on a cycle is a def, wherever the walk enters', () => {
    const department = z
      .object({
        get teams() {
          return z.array(team);
        },
      })
      .meta({ id: 'department' });
    const team = z
      .object({
        get department() {
          return department;
        },
      })
      .meta({ id: 'team' });

    const fromTeam = walkSchemas([{ at: placeAt('body'), schema: team }], () => undefined);
    const fromDepartment = walkSchemas(
      [{ at: placeAt('body'), schema: department }],
      () => undefined,
    );

    const departmentDef = {
      type: 'object',
      fields: {
        teams: { required: true, schema: { type: 'array', items: { type: 'ref', name: 'team' } } },
      },
    };
    const teamDef = {
      type: 'object',
      fields: { department: { required: true, schema: { type: 'ref', name: 'department' } } },
    };
    const defs = { department: departmentDef, team: teamDef };
    expect(refusalsOf(fromTeam)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'team' })],
      defs,
    });
    expect(refusalsOf(fromDepartment)).toEqual({
      located: [walkedTo({ type: 'ref', name: 'department' })],
      defs,
    });
  });

  test('many schemas that all refer to each other without an id fail once each at most', () => {
    const count = 8;
    const schemas: z.ZodObject[] = [];
    for (let index = 0; index < count; index++) {
      const shape = {};
      for (let other = 0; other < count; other++) {
        Object.defineProperty(shape, `to${other}`, {
          enumerable: true,
          get: () => schemas[other],
        });
      }
      schemas.push(z.object(shape));
    }

    const walked = walkSchemas([{ at: placeAt('body'), schema: schemas[0]! }], () => undefined);

    const [body] = walked.located;
    const failures = body?.walked.kind === 'not-allowed' ? refusalsIn(body.walked.tree) : [];
    expect(body?.walked.kind).toBe('not-allowed');
    expect(failures.length).toBeLessThanOrEqual(count);
  });

  describe('a recursive discriminated union with an id on a variant', () => {
    const leaf = z.object({ type: z.literal('leaf'), value: z.number() });
    const branch = z
      .object({
        type: z.literal('branch'),
        get children(): z.ZodArray<typeof tree> {
          return z.array(tree);
        },
      })
      .meta({ id: 'branch' });
    const tree: z.ZodDiscriminatedUnion<[typeof leaf, typeof branch], 'type'> =
      z.discriminatedUnion('type', [leaf, branch]);

    const leafNode = {
      type: 'object',
      fields: {
        type: { required: true, schema: { type: 'enum', values: ['leaf'], open: false } },
        value: { required: true, schema: { type: 'number' } },
      },
    } as const;
    const treeNode = {
      type: 'tagged',
      discriminator: 'type',
      variants: { '"leaf"': leafNode, '"branch"': { type: 'ref', name: 'branch' } },
    } as const;
    const branchDef = {
      type: 'object',
      fields: {
        type: { required: true, schema: { type: 'enum', values: ['branch'], open: false } },
        children: { required: true, schema: { type: 'array', items: treeNode } },
      },
    } as const;

    test('entering at the union, the variant is a ref to its def', () => {
      const walked = walkSchemas(
        [
          { at: placeAt('tree'), schema: tree },
          { at: placeAt('branch'), schema: branch },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked)).toEqual({
        located: [walkedTo(treeNode), walkedTo({ type: 'ref', name: 'branch' })],
        defs: { branch: branchDef },
      });
    });

    test('entering at the variant gives the same nodes and defs', () => {
      const walked = walkSchemas(
        [
          { at: placeAt('branch'), schema: branch },
          { at: placeAt('tree'), schema: tree },
        ],
        () => undefined,
      );

      expect(refusalsOf(walked)).toEqual({
        located: [walkedTo({ type: 'ref', name: 'branch' }), walkedTo(treeNode)],
        defs: { branch: branchDef },
      });
    });
  });

  describe('determinism whatever the entry', () => {
    const order: z.ZodType = z
      .object({
        get customer(): z.ZodType {
          return customer;
        },
      })
      .meta({ id: 'order' });
    const customer: z.ZodType = z
      .object({
        get orders(): z.ZodType {
          return z.array(order);
        },
        get address(): z.ZodType {
          return address;
        },
      })
      .meta({ id: 'customer' });
    const address: z.ZodType = z
      .object({
        get order(): z.ZodType {
          return order;
        },
      })
      .meta({ id: 'address' });

    test('a ring of three defs behind a written def gives the same defs in either order', () => {
      const orderFirst = walkSchemas(
        [
          { at: placeAt('order'), schema: order },
          { at: placeAt('customer'), schema: customer },
        ],
        () => undefined,
      );
      const customerFirst = walkSchemas(
        [
          { at: placeAt('customer'), schema: customer },
          { at: placeAt('order'), schema: order },
        ],
        () => undefined,
      );

      const inOrderFirst = refusalsOf(orderFirst);
      expect(Object.keys(orderFirst.defs).sort()).toEqual(['address', 'customer', 'order']);
      expect(refusalsOf(customerFirst)).toEqual({
        ...inOrderFirst,
        located: [...inOrderFirst.located].reverse(),
      });
    });

    const first: z.ZodType = z
      .object({
        get next(): z.ZodType {
          return second;
        },
      })
      .meta({ id: 'first' });
    const second: z.ZodType = z.object({
      get next(): z.ZodType {
        return third;
      },
    });
    const third: z.ZodType = z
      .object({
        get next(): z.ZodType {
          return fourth;
        },
      })
      .meta({ id: 'third' });
    const fourth: z.ZodType = z.object({
      get next(): z.ZodType {
        return first;
      },
    });
    const fromFirst = walkSchemas([{ at: placeAt('body'), schema: first }], () => undefined);

    test.each([
      ['second', second],
      ['third', third],
      ['fourth', fourth],
    ])(
      'a ring of four with two ids entered at the %s schema gives the same defs',
      (_name, schema) => {
        const walked = walkSchemas([{ at: placeAt('body'), schema }], () => undefined);

        expect(Object.keys(fromFirst.defs).sort()).toEqual(['first', 'third']);
        expect(walked.defs).toEqual(fromFirst.defs);
      },
    );
  });

  test('a ring of 400 schemas walks fast', () => {
    const count = 400;
    const ring: z.ZodType[] = [];
    for (let index = 0; index < count; index++) {
      const shape = {};
      Object.defineProperty(shape, 'next', {
        enumerable: true,
        get: () => ring[(index + 1) % count],
      });
      const link = z.object(shape);
      ring.push(index === 0 ? link.meta({ id: 'start' }) : link);
    }

    const started = performance.now();
    const walked = walkSchemas([{ at: placeAt('body'), schema: ring[0]! }], () => undefined);
    const elapsed = performance.now() - started;

    expect(walked.located[0]?.walked.kind).toBe('walked');
    expect(elapsed).toBeLessThan(1000);
  });

  test('a failing def met by many paths is reported once and walked once', () => {
    const count = 26;
    const steps: z.ZodType[] = [];
    const nextOf = (index: number) => steps[(index + 1) % (count + 1)];
    for (let index = 0; index <= count; index++) {
      const side = () =>
        z.object({
          get next() {
            return nextOf(index);
          },
        });
      const shape =
        index === count ? { placedAt: z.date(), a: side(), b: side() } : { a: side(), b: side() };
      steps.push(z.object(shape).meta({ id: `step${index}` }));
    }

    const started = performance.now();
    const walked = walkSchemas([{ at: placeAt('body'), schema: steps[0]! }], () => undefined);
    const elapsed = performance.now() - started;

    expect(refusalsOf(walked).located[0]).toMatchObject({
      kind: 'not-allowed',
      failures: [{ construct: 'z.date()' }],
    });
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('reachedDefsOf', () => {
  const ref = (name: string): SchemaNode => ({ type: 'ref', name });
  const holding = (node: SchemaNode): SchemaNode => ({ type: 'array', items: node });

  test.each([
    {
      reach: 'a chain whose last def closes a cycle',
      defs: { a: holding(ref('b')), b: holding(ref('c')), c: holding(ref('a')), d: ref('a') },
      reached: ['a', 'b', 'c'],
    },
    {
      reach: 'a ref that names no def',
      defs: { a: holding(ref('gone')), d: ref('a') },
      reached: ['a', 'gone'],
    },
  ])('the def names nodes reach through $reach are each named once', ({ defs, reached }) => {
    const nodes = [holding(ref('a')), ref('a')];

    const names = reachedDefsOf(nodes, defs);

    expect(names).toEqual(reached);
  });
});
