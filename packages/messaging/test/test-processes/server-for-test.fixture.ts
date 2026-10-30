import { beforeEach, expect, test } from 'vitest';
import { aMotoServer } from '../moto-server.ts';
import { stubPids } from './stub-pids.ts';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  await aMotoServer();
});

test('the first test starts a server', async () => {
  await expect(stubPids()).resolves.toHaveLength(1);
});

test('the next test finds the first test’s server gone, and its own running', async () => {
  const pids = await stubPids();

  expect(pids.map(isRunning)).toEqual([false, true]);
});
