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

    expect(fromTeam.kind === 'walked' && fromTeam.defs).toEqual(
      fromDepartment.kind === 'walked' && fromDepartment.defs,
    );
  });
});
