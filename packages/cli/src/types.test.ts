import { describe, expectTypeOf, test } from 'vitest';
import type { Config, Layout } from './index.ts';

describe('the records cf-loom.config.ts holds', () => {
  test('a Config holds the layout, and no more', () => {
    expectTypeOf<keyof Config>().toEqualTypeOf<'layout'>();
  });

  test('a Layout holds the Handler paths of each kind and the paths of the two generated files, and no more', () => {
    expectTypeOf<keyof Layout>().toEqualTypeOf<
      'endpoint' | 'guard' | 'command' | 'subscription' | 'handlerMap' | 'readers'
    >();
  });
});
