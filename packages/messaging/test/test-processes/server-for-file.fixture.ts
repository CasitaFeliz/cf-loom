import { beforeAll, expect, test } from 'vitest';
import { aMotoServer, type MotoServer } from '../moto-server.ts';

let server: MotoServer;

beforeAll(async () => {
  server = await aMotoServer();
});

test('the first test finds the server answering', async () => {
  const response = await fetch(server.url);

  expect(response.ok).toBe(true);
});

test('the second test finds it answering still', async () => {
  const response = await fetch(server.url);

  expect(response.ok).toBe(true);
});
