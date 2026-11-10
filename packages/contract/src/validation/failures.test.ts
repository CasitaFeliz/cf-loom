import { describe, expect, test } from 'vitest';
import { type Failure, failureLineOf, problemLineOf } from '../internal/index.ts';

describe('problemLineOf', () => {
  test('a path is written with its segments joined by dots', () => {
    const line = problemLineOf({
      at: ['groups', 'orders', 'endpoints', 0, 'path'],
      reason: 'is missing',
    });

    expect(line).toBe('groups.orders.endpoints.0.path is missing');
  });

  test('a key holding a dot or a space is one quoted segment', () => {
    const line = problemLineOf({
      at: ['codes', 'BAD_REQUEST', 'body', 'fields', 'a.b', 'required'],
      reason: 'is not true or false',
    });

    expect(line).toBe('codes.BAD_REQUEST.body.fields."a.b".required is not true or false');
  });

  test('the root has no segments and is written (root)', () => {
    const line = problemLineOf({ at: [], reason: 'is not an object' });

    expect(line).toBe('(root) is not an object');
  });
});

describe('failureLineOf', () => {
  test.for([
    [
      'a declaration failure',
      {
        kind: 'declaration',
        site: { kind: 'root' },
        steps: [{ kind: 'field', name: 'name' }],
        rule: 'name-grammar',
        message: 'is not kebab-case',
        declaration: undefined,
      },
      '(root) name name-grammar: is not kebab-case',
    ],
    [
      'a declaration failure at the root',
      {
        kind: 'declaration',
        site: { kind: 'root' },
        steps: [],
        rule: 'blank-text',
        message: 'is blank',
        declaration: undefined,
      },
      '(root) blank-text: is blank',
    ],
    [
      'a declaration failure in an Endpoint',
      {
        kind: 'declaration',
        site: { kind: 'endpoint', identity: 'GET /orders', name: 'listOrders' },
        steps: [
          { kind: 'field', name: 'success' },
          { kind: 'field', name: 'status' },
        ],
        rule: 'success-status',
        message: 'is not a status',
        declaration: undefined,
      },
      'endpoints.GET /orders (listOrders) success.status success-status: is not a status',
    ],
    [
      'a construct that is not allowed',
      {
        kind: 'not-allowed',
        site: { kind: 'def', name: 'id' },
        steps: [],
        construct: 'z.any()',
        declaration: undefined,
        alsoIn: [],
        origin: undefined,
      },
      'defs.id not allowed: z.any()',
    ],
    [
      'a construct that is not allowed and what to use instead',
      {
        kind: 'not-allowed',
        site: { kind: 'root' },
        steps: [],
        construct: 'z.date()',
        instead: 'z.iso.datetime()',
        declaration: undefined,
        alsoIn: [],
        origin: undefined,
      },
      '(root) not allowed: z.date() (use z.iso.datetime())',
    ],
    [
      'a construct that is not allowed and the other sites that reach it',
      {
        kind: 'not-allowed',
        site: { kind: 'endpoint', identity: 'GET /orders', name: 'listOrders' },
        steps: [{ kind: 'field', name: 'placedAt' }],
        construct: 'z.date()',
        instead: 'z.iso.datetime()',
        declaration: undefined,
        alsoIn: [
          { kind: 'event', identity: 'OrderCreated@1' },
          { kind: 'command', identity: 'ChargeCard@1' },
        ],
        origin: undefined,
      },
      'endpoints.GET /orders (listOrders) placedAt not allowed: z.date() (use z.iso.datetime()) (also in events.OrderCreated@1 and commands.ChargeCard@1)',
    ],
    [
      'a construct that is not allowed and three other sites that reach it',
      {
        kind: 'not-allowed',
        site: { kind: 'endpoint', identity: 'GET /orders', name: 'listOrders' },
        steps: [{ kind: 'field', name: 'placedAt' }],
        construct: 'z.date()',
        instead: 'z.iso.datetime()',
        declaration: undefined,
        alsoIn: [
          { kind: 'event', identity: 'OrderCreated@1' },
          { kind: 'command', identity: 'ChargeCard@1' },
          { kind: 'event', identity: 'OrderPaid@1' },
        ],
        origin: undefined,
      },
      'endpoints.GET /orders (listOrders) placedAt not allowed: z.date() (use z.iso.datetime()) (also in events.OrderCreated@1, commands.ChargeCard@1 and events.OrderPaid@1)',
    ],
    [
      'a construct that is not allowed and the package that declares it',
      {
        kind: 'not-allowed',
        site: { kind: 'export', name: 'money' },
        steps: [],
        construct: 'z.any()',
        declaration: undefined,
        alsoIn: [],
        origin: '@org/definitions@4.2.0#money',
      },
      'exports.money not allowed: z.any() (declared in @org/definitions@4.2.0#money)',
    ],
    [
      'a construct that is not allowed, the other sites that reach it and the package that declares it',
      {
        kind: 'not-allowed',
        site: { kind: 'event', identity: 'OrderCreated@2' },
        steps: [{ kind: 'field', name: 'total' }],
        construct: 'z.date()',
        instead: 'z.iso.datetime()',
        declaration: undefined,
        alsoIn: [{ kind: 'command', identity: 'ChargeCard@1' }],
        origin: '@org/definitions@4.2.0#money',
      },
      'events.OrderCreated@2 total not allowed: z.date() (use z.iso.datetime()) (also in commands.ChargeCard@1) (declared in @org/definitions@4.2.0#money)',
    ],
  ] as const satisfies readonly (readonly [string, Failure, string])[])(
    'a line says where %s sits first',
    ([, failure, line]) => {
      expect(failureLineOf(failure)).toBe(line);
    },
  );
});
