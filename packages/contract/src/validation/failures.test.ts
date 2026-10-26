import { describe, expect, test } from 'vitest';
import { type Failure, failureLineOf, locationOf } from '../internal/index.ts';

describe('locationOf', () => {
  test('a path is written with its segments joined by dots', () => {
    const location = locationOf(['groups', 'orders', 'endpoints', 0, 'path']);

    expect(location).toBe('groups.orders.endpoints.0.path');
  });

  test('the root has no segments and is written (root)', () => {
    const location = locationOf([]);

    expect(location).toBe('(root)');
  });
});

describe('failureLineOf', () => {
  test.for([
    [
      'a declaration failure',
      { kind: 'declaration', at: ['name'], rule: 'name-grammar', message: 'is not kebab-case' },
      'name name-grammar: is not kebab-case',
    ],
    [
      'a declaration failure at the root',
      { kind: 'declaration', at: [], rule: 'blank-text', message: 'is blank' },
      '(root) blank-text: is blank',
    ],
    [
      'a construct that is not allowed',
      { kind: 'not-allowed', at: ['defs', 'id'], construct: 'z.any()' },
      'defs.id not allowed: z.any()',
    ],
    [
      'a construct that is not allowed and what to use instead',
      { kind: 'not-allowed', at: [], construct: 'z.date()', instead: 'z.iso.datetime()' },
      '(root) not allowed: z.date() (use z.iso.datetime())',
    ],
  ] as const satisfies readonly (readonly [string, Failure, string])[])(
    'a line says where %s sits first',
    ([, failure, line]) => {
      expect(failureLineOf(failure)).toBe(line);
    },
  );
});
