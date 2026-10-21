import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { reachedDefsOf, type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function walkedAt(at: readonly (string | number)[], value: unknown) {
  return { at, walked: { kind: 'walked', value } };
}

function refusedAt(
  at: readonly (string | number)[],
  failures: readonly { readonly at: readonly (string | number)[]; readonly construct: string }[],
) {
  const named = failures.map((failure) => ({ kind: 'not-allowed', ...failure }));
  return { at, walked: { kind: 'not-allowed', failures: named } };
}

const unnamedCycle = { construct: 'a cycle without .meta({ id })', instead: '.meta({ id })' };

const categoryDef = {
  type: 'object',
  mode: 'open',
  fields: {
    name: { required: true, schema: { type: 'string' } },
    children: {
      required: true,
      schema: { type: 'array', items: { type: 'ref', name: 'category' } },
    },
  },
} as const;

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
      located: [walkedAt(['body'], { type: 'ref', name: 'category' })],
      defs: { category: categoryDef },
    });
  });

  test('a cycle through z.lazy() is written once under defs and referenced by ref', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(category) }))
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      located: [walkedAt(['body'], { type: 'ref', name: 'category' })],
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
      located: [walkedAt(['body'], { type: 'ref', name: 'category' })],
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
      located: [walkedAt(['body'], { type: 'ref', name: 'outer' })],
      defs: {
        inner: {
          type: 'object',
          mode: 'open',
          fields: {
            c: { required: true, schema: { type: 'array', items: { type: 'ref', name: 'outer' } } },
          },
        },
        outer: { type: 'ref', name: 'inner' },
      },
    });
  });

  describe('a cycle through z.lazy() alone', () => {
    const lazyCycle = { construct: 'a cycle through z.lazy() alone, which zod cannot parse' };
    const nullable: z.ZodType = z.lazy(() => nullable.nullable()).meta({ id: 'nullable' });
    const described: z.ZodType = z
      .lazy(() => described)
      .meta({ id: 'described', description: 'Itself' });

    test('a z.lazy() of itself with an id fails where the walk enters it and writes no def', () => {
      const node: z.ZodType = z.lazy(() => node).meta({ id: 'node' });

      const walked = walkBody(node);

      expect(walked).toEqual({
        located: [refusedAt(['body'], [{ at: ['body'], ...lazyCycle }])],
        defs: {},
      });
    });

    test.each([
      ['nullable', nullable],
      ['described', described],
    ])('a %s z.lazy() of itself with an id fails the same', (_name, schema) => {
      const walked = walkBody(schema);

      expect(walked).toEqual({
        located: [refusedAt(['body'], [{ at: ['body'], ...lazyCycle }])],
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
          located: [refusedAt(['body'], [{ at: ['body'], ...lazyCycle }])],
          defs: {},
        });
      });
    });

    test('a cycle entered at a lazy with no id fails the same', () => {
      const entry: z.ZodType = z.lazy(() => named);
      const named: z.ZodType = z.lazy(() => entry).meta({ id: 'named' });

      const walked = walkBody(entry);

      expect(walked).toEqual({
        located: [refusedAt(['body'], [{ at: ['body'], ...lazyCycle }])],
        defs: {},
      });
    });

    test('a cycle used at two locations is the same failure at both', () => {
      const node: z.ZodType = z.lazy(() => node).meta({ id: 'node' });

      const walked = walkSchemas(
        [
          { at: ['body'], schema: node },
          { at: ['success'], schema: z.array(node) },
        ],
        () => undefined,
      );

      const failure = { at: ['body'], ...lazyCycle };
      expect(walked).toEqual({
        located: [refusedAt(['body'], [failure]), refusedAt(['success'], [failure])],
        defs: {},
      });
      const [first, second] = walked.located;
      const failuresOf = (location: typeof first) =>
        location?.walked.kind === 'not-allowed' ? location.walked.failures : [];
      expect(failuresOf(first)[0]).toBe(failuresOf(second)[0]);
    });

    test('a z.lazy() of itself as a discriminated union variant fails and does not throw', () => {
      const variant: z.ZodType = z.lazy(() => variant);
      const union = z.discriminatedUnion('kind', [variant as unknown as z.ZodObject]);

      const walked = walkBody(union);

      expect(walked).toEqual({
        located: [
          refusedAt(
            ['body'],
            [
              {
                at: ['body', 'variants', 0],
                construct: 'a discriminated union variant that is not an object',
              },
            ],
          ),
        ],
        defs: {},
      });
    });
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
        { at: ['body'], schema: category },
        { at: ['success'], schema: z.array(category) },
      ],
      () => undefined,
    );

    expect(walked).toEqual({
      located: [
        walkedAt(['body'], { type: 'ref', name: 'category' }),
        walkedAt(['success'], { type: 'array', items: { type: 'ref', name: 'category' } }),
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
      located: [
        refusedAt(['body'], [{ at: ['body', 'fields', 'children', 'items'], ...unnamedCycle }]),
      ],
      defs: {},
    });
  });

  test('a cycle without an id used at two locations is the same failure at both', () => {
    const category = z.object({
      get children() {
        return z.array(category);
      },
    });

    const walked = walkSchemas(
      [
        { at: ['body'], schema: category },
        { at: ['success'], schema: z.array(category) },
      ],
      () => undefined,
    );

    const failure = { at: ['body', 'fields', 'children', 'items'], ...unnamedCycle };
    expect(walked).toEqual({
      located: [refusedAt(['body'], [failure]), refusedAt(['success'], [failure])],
      defs: {},
    });
    const [first, second] = walked.located;
    const failuresOf = (location: typeof first) =>
      location?.walked.kind === 'not-allowed' ? location.walked.failures : [];
    expect(failuresOf(first)[0]).toBe(failuresOf(second)[0]);
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
        { at: ['body'], schema: category },
        { at: ['success'], schema: folder },
      ],
      () => undefined,
    );

    expect(walked).toEqual({
      located: [
        walkedAt(['body'], { type: 'ref', name: 'node' }),
        refusedAt(
          ['success'],
          [{ at: ['success'], construct: 'two schemas with .meta({ id: "node" })' }],
        ),
      ],
      defs: {
        node: {
          type: 'object',
          mode: 'open',
          fields: {
            children: {
              required: true,
              schema: { type: 'array', items: { type: 'ref', name: 'node' } },
            },
          },
        },
      },
    });
  });

  test('an id named __proto__ is a def like any other', () => {
    const node = z
      .object({
        get children() {
          return z.array(node);
        },
      })
      .meta({ id: '__proto__' });

    expect(walkBody(node)).toEqual({
      located: [walkedAt(['body'], { type: 'ref', name: '__proto__' })],
      defs: {
        ['__proto__']: {
          type: 'object',
          mode: 'open',
          fields: {
            children: {
              required: true,
              schema: { type: 'array', items: { type: 'ref', name: '__proto__' } },
            },
          },
        },
      },
    });
  });

  test('an id on a schema that closes no cycle is ignored', () => {
    const money = z.object({ amount: z.int() }).meta({ id: 'Money' });

    expect(walkBody(money)).toEqual({
      located: [
        walkedAt(['body'], {
          type: 'object',
          mode: 'open',
          fields: { amount: { required: true, schema: { type: 'number', int: true } } },
        }),
      ],
      defs: {},
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
      mode: 'open',
      fields: { department: { required: true, schema: { type: 'ref', name: 'department' } } },
    } as const;
    const departmentDef = {
      type: 'object',
      mode: 'open',
      fields: { teams: { required: true, schema: { type: 'array', items: teamNode } } },
    } as const;
    const expected = {
      located: [
        walkedAt(['team'], teamNode),
        walkedAt(['department'], { type: 'ref', name: 'department' }),
      ],
      defs: { department: departmentDef },
    };

    test('entering at the schema without the id gives the def and refs', () => {
      const walked = walkSchemas(
        [
          { at: ['team'], schema: team },
          { at: ['department'], schema: department },
        ],
        () => undefined,
      );

      expect(walked).toEqual(expected);
    });

    test('entering at the schema with the id gives the same nodes and defs', () => {
      const walked = walkSchemas(
        [
          { at: ['department'], schema: department },
          { at: ['team'], schema: team },
        ],
        () => undefined,
      );

      expect(walked).toEqual({ ...expected, located: [...expected.located].reverse() });
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
      ['department', department, ['body', 'fields', 'teams', 'items', 'fields', 'department']],
      ['team', team, ['body', 'fields', 'department', 'fields', 'teams', 'items']],
    ])('entered at the %s, the cycle fails', (_name, schema, at) => {
      expect(walkBody(schema)).toEqual({
        located: [refusedAt(['body'], [{ at, ...unnamedCycle }])],
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

    const fromTeam = walkSchemas([{ at: ['body'], schema: team }], () => undefined);
    const fromDepartment = walkSchemas([{ at: ['body'], schema: department }], () => undefined);

    const departmentDef = {
      type: 'object',
      mode: 'open',
      fields: {
        teams: { required: true, schema: { type: 'array', items: { type: 'ref', name: 'team' } } },
      },
    };
    const teamDef = {
      type: 'object',
      mode: 'open',
      fields: { department: { required: true, schema: { type: 'ref', name: 'department' } } },
    };
    const defs = { department: departmentDef, team: teamDef };
    expect(fromTeam).toEqual({
      located: [walkedAt(['body'], { type: 'ref', name: 'team' })],
      defs,
    });
    expect(fromDepartment).toEqual({
      located: [walkedAt(['body'], { type: 'ref', name: 'department' })],
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

    const walked = walkSchemas([{ at: ['body'], schema: schemas[0]! }], () => undefined);

    const [body] = walked.located;
    const failures = body?.walked.kind === 'not-allowed' ? body.walked.failures : [];
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
      mode: 'open',
      fields: {
        type: { required: true, schema: { type: 'literal', value: 'leaf' } },
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
      mode: 'open',
      fields: {
        type: { required: true, schema: { type: 'literal', value: 'branch' } },
        children: { required: true, schema: { type: 'array', items: treeNode } },
      },
    } as const;

    test('entering at the union, the variant is a ref to its def', () => {
      const walked = walkSchemas(
        [
          { at: ['tree'], schema: tree },
          { at: ['branch'], schema: branch },
        ],
        () => undefined,
      );

      expect(walked).toEqual({
        located: [
          walkedAt(['tree'], treeNode),
          walkedAt(['branch'], { type: 'ref', name: 'branch' }),
        ],
        defs: { branch: branchDef },
      });
    });

    test('entering at the variant gives the same nodes and defs', () => {
      const walked = walkSchemas(
        [
          { at: ['branch'], schema: branch },
          { at: ['tree'], schema: tree },
        ],
        () => undefined,
      );

      expect(walked).toEqual({
        located: [
          walkedAt(['branch'], { type: 'ref', name: 'branch' }),
          walkedAt(['tree'], treeNode),
        ],
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
          { at: ['order'], schema: order },
          { at: ['customer'], schema: customer },
        ],
        () => undefined,
      );
      const customerFirst = walkSchemas(
        [
          { at: ['customer'], schema: customer },
          { at: ['order'], schema: order },
        ],
        () => undefined,
      );

      expect(Object.keys(orderFirst.defs).sort()).toEqual(['address', 'customer', 'order']);
      expect(customerFirst).toEqual({ ...orderFirst, located: [...orderFirst.located].reverse() });
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
    const fromFirst = walkSchemas([{ at: ['body'], schema: first }], () => undefined);

    test.each([
      ['second', second],
      ['third', third],
      ['fourth', fourth],
    ])(
      'a ring of four with two ids entered at the %s schema gives the same defs',
      (_name, schema) => {
        const walked = walkSchemas([{ at: ['body'], schema }], () => undefined);

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
    const walked = walkSchemas([{ at: ['body'], schema: ring[0]! }], () => undefined);
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
    const walked = walkSchemas([{ at: ['body'], schema: steps[0]! }], () => undefined);
    const elapsed = performance.now() - started;

    expect(walked.located[0]?.walked).toMatchObject({
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
