import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

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
      kind: 'walked',
      nodes: [{ type: 'ref', name: 'category' }],
      defs: { category: categoryDef },
    });
  });

  test('a cycle through z.lazy() is written once under defs and referenced by ref', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(category) }))
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      kind: 'walked',
      nodes: [{ type: 'ref', name: 'category' }],
      defs: { category: categoryDef },
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
      kind: 'walked',
      nodes: [
        { type: 'ref', name: 'category' },
        { type: 'array', items: { type: 'ref', name: 'category' } },
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
      kind: 'not-allowed',
      failures: [
        {
          at: ['body', 'fields', 'children', 'items'],
          construct: 'a cycle without .meta({ id })',
          instead: '.meta({ id })',
        },
      ],
    });
  });

  test('a cycle without an id used at two locations is reported once', () => {
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

    expect(walked).toEqual({
      kind: 'not-allowed',
      failures: [
        {
          at: ['body', 'fields', 'children', 'items'],
          construct: 'a cycle without .meta({ id })',
          instead: '.meta({ id })',
        },
      ],
    });
  });

  test('two cyclic schemas with one id fail', () => {
    const category = z
      .object({
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'Node' });
    const folder = z
      .object({
        get folders() {
          return z.array(folder);
        },
      })
      .meta({ id: 'Node' });

    const walked = walkSchemas(
      [
        { at: ['body'], schema: category },
        { at: ['success'], schema: folder },
      ],
      () => undefined,
    );

    expect(walked).toEqual({
      kind: 'not-allowed',
      failures: [{ at: ['success'], construct: 'two schemas with .meta({ id: "Node" })' }],
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
      kind: 'walked',
      nodes: [{ type: 'ref', name: '__proto__' }],
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
      kind: 'walked',
      nodes: [
        {
          type: 'object',
          mode: 'open',
          fields: { amount: { required: true, schema: { type: 'number', int: true } } },
        },
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
      kind: 'walked',
      nodes: [teamNode, { type: 'ref', name: 'department' }],
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

      expect(walked).toEqual({ ...expected, nodes: [...expected.nodes].reverse() });
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
        kind: 'not-allowed',
        failures: [{ at, construct: 'a cycle without .meta({ id })', instead: '.meta({ id })' }],
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
    expect(fromTeam).toEqual({ kind: 'walked', nodes: [{ type: 'ref', name: 'team' }], defs });
    expect(fromDepartment).toEqual({
      kind: 'walked',
      nodes: [{ type: 'ref', name: 'department' }],
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

    const failures = walked.kind === 'not-allowed' ? walked.failures : [];
    expect(walked.kind).toBe('not-allowed');
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
      open: false,
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
        kind: 'walked',
        nodes: [treeNode, { type: 'ref', name: 'branch' }],
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
        kind: 'walked',
        nodes: [{ type: 'ref', name: 'branch' }, treeNode],
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

      expect(orderFirst.kind === 'walked' && Object.keys(orderFirst.defs).sort()).toEqual([
        'address',
        'customer',
        'order',
      ]);
      expect(customerFirst).toEqual({
        ...orderFirst,
        nodes: orderFirst.kind === 'walked' ? [...orderFirst.nodes].reverse() : [],
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
    const fromFirst = walkSchemas([{ at: ['body'], schema: first }], () => undefined);

    test.each([
      ['second', second],
      ['third', third],
      ['fourth', fourth],
    ])(
      'a ring of four with two ids entered at the %s schema gives the same defs',
      (_name, schema) => {
        const walked = walkSchemas([{ at: ['body'], schema }], () => undefined);

        expect(fromFirst.kind === 'walked' && Object.keys(fromFirst.defs).sort()).toEqual([
          'first',
          'third',
        ]);
        expect(walked.kind === 'walked' && walked.defs).toEqual(
          fromFirst.kind === 'walked' && fromFirst.defs,
        );
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

    expect(walked.kind).toBe('walked');
    expect(elapsed).toBeLessThan(1000);
  });

  test('a failing def met by many paths is reported once and walked once', () => {
    const count = 18;
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

    expect(walked).toMatchObject({ kind: 'not-allowed', failures: [{ construct: 'z.date()' }] });
    expect(elapsed).toBeLessThan(1000);
  });
});
