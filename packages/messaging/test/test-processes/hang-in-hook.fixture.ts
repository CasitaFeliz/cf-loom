import { beforeAll, expect, test } from 'vitest';
import { aNatsServer } from '../nats-server.ts';

beforeAll(async () => {
  await aNatsServer();
}, 2_000);

test('a test of the file', () => {
  expect(1).toBe(1);
});
