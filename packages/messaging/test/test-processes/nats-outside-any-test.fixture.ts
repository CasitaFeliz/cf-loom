import { expect, test } from 'vitest';
import { aNatsServer } from '../nats-server.ts';

await aNatsServer();

test('a test of the file', () => {
  expect(1).toBe(1);
});
