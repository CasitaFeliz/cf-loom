import { beforeEach, expect, test } from 'vitest';
import { type Ran, runProcess } from '../test-process.ts';
import { aStubStarted } from './stub-pids.ts';

let running: Promise<Ran>;

beforeEach(async () => {
  running = runProcess('moto_server', []);
  running.catch(() => undefined);
  await aStubStarted();
});

test('a run that never exits', async () => {
  const ran = await running;

  expect(ran.status).toBe(0);
}, 2_000);
