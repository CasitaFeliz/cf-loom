import { beforeAll, expect, test } from 'vitest';
import { type Ran, runProcess } from '../test-process.ts';
import { aStubStarted } from './stub-pids.ts';

let running: Promise<Ran>;

beforeAll(async () => {
  running = runProcess('nats-server', []);
  running.catch(() => undefined);
  await aStubStarted();
});

beforeAll(async () => {
  await running;
}, 2_000);

test('a test of the file', () => {
  expect(1).toBe(1);
});
