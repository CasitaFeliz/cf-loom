import { afterEach, expect, test } from 'vitest';
import { aMotoServer, type MotoServer } from '../moto-server.ts';

let server: MotoServer;

afterEach(async () => {
  await server.stop();
}, 2_000);

test('a server that ignores SIGTERM', async () => {
  server = await aMotoServer();

  const response = await fetch(server.url);

  expect(response.ok).toBe(true);
});
