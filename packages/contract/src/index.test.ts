import { expect, test } from 'vitest';
import * as entry from './index.js';

test('entry loads', () => {
  expect(entry).toBeDefined();
});
