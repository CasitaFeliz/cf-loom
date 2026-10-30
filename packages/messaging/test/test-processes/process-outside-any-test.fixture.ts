import { expect, test } from 'vitest';
import { startProcess } from '../test-process.ts';

startProcess(process.execPath, ['--version']);

test('a test of the file', () => {
  expect(1).toBe(1);
});
