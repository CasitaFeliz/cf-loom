import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { startProcess } from '../../test/test-process.ts';

const nodeExecutable = globalThis.process.execPath;

const fixture = fileURLToPath(new URL('../../test/in-process-exit.ts', import.meta.url));

describe('a process running inProcess()', () => {
  test('whose Handler failed, with its redelivery due in an hour, exits once messaging is closed', async () => {
    const running = startProcess(nodeExecutable, [fixture, 'closed']);

    const exit = await running.exited;

    expect(running.stdout()).toBe('failed\n');
    expect(exit, running.stderr()).toEqual({ status: 0, signal: null });
  });

  test('whose Handler failed, with its redelivery due in an hour, exits though messaging was never closed: a Message waiting for redelivery never keeps it alive', async () => {
    const running = startProcess(nodeExecutable, [fixture, 'open']);

    const exit = await running.exited;

    expect(running.stdout()).toBe('failed\n');
    expect(exit, running.stderr()).toEqual({ status: 0, signal: null });
  });
});
