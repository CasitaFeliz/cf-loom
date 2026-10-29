import { afterEach, describe, expect, test, vi } from 'vitest';
import { aMotoServer } from './moto-server.ts';

describe('a test moto server', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('starting one without moto_server on PATH fails naming moto_server and where its pinned requirements are', async () => {
    vi.stubEnv('PATH', '');

    const starting = aMotoServer();

    await expect(starting).rejects.toThrow(
      'moto_server is not on PATH: install moto from packages/messaging/test/moto-requirements.txt (see CLAUDE.md)',
    );
  });
});
