import { beforeAll, expect, test } from 'vitest';
import { aNatsServer, type NatsServer } from '../nats-server.ts';
import { aStubStarted } from './stub-pids.ts';

let starting: Promise<NatsServer>;

beforeAll(async () => {
  starting = aNatsServer();
  starting.catch(() => undefined);
  await aStubStarted();
});

beforeAll(async () => {
  await starting;
}, 2_000);

test('a test of the file', () => {
  expect(1).toBe(1);
});
