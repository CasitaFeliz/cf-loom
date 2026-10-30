import { expect, test } from 'vitest';
import { aMotoServer } from '../moto-server.ts';

test('a start that never listens', async () => {
  const server = await aMotoServer();

  expect(server.url).toMatch(/^http:/);
}, 2_000);
