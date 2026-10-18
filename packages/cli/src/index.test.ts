import { expect, test } from 'vitest';
import { defineConfig } from './index.ts';

test('defineConfig returns the configuration it is given', () => {
  const config = { scope: '@org' };

  const defined = defineConfig(config);

  expect(defined).toEqual({ scope: '@org' });
});
