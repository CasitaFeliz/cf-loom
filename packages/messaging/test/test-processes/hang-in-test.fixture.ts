import { beforeEach, expect, test } from 'vitest';
import { aMotoServer, type MotoServer } from '../moto-server.ts';
import { aStubStarted } from './stub-pids.ts';

let starting: Promise<MotoServer>;

beforeEach(async () => {
  starting = aMotoServer();
  starting.catch(() => undefined);
  await aStubStarted();
});

test('a start that never listens', async () => {
  const server = await starting;

  expect(server.url).toMatch(/^http:/);
}, 2_000);
