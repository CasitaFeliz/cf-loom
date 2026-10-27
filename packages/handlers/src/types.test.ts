import type { Endpoint } from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { HandledBy, Pairing } from './index.ts';
import { hookFailureOf } from './internal/index.ts';

describe('the records a Service reads off a Handler', () => {
  test('a HandledBy brand holds a declaration and nothing else a Service can name', () => {
    expectTypeOf<Exclude<keyof HandledBy<Endpoint>, symbol>>().toEqualTypeOf<'declaration'>();
  });

  test('a Pairing holds a declaration and its Reader, and nothing else', () => {
    expectTypeOf<keyof Pairing>().toEqualTypeOf<'declaration' | 'reader'>();
  });
});

describe('the hooks a Service gives', () => {
  test('a hook may return a value', async () => {
    const failure = await hookFailureOf((count: number) => count + 1, 1, {
      source: 'orders',
      hook: 'onServiceFault',
    });

    expect(failure).toBeUndefined();
  });
});
