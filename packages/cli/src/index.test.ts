import { expect, test } from 'vitest';
import * as entry from './index.ts';

test('entry loads', () => {
  expect(entry).toBeDefined();
});
