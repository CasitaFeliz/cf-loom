import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const pollIntervalMs = 20;

/** The pids the stub servers of this run logged to the file `STUB_PIDS` names, one each once it started. */
export async function stubPids(): Promise<readonly number[]> {
  const written = await readFile(process.env['STUB_PIDS'] ?? '', 'utf8').catch(() => '');
  return written
    .split('\n')
    .filter((line) => line !== '')
    .map(Number);
}

/** Resolves once a stub server has logged its pid: it has started, and a silent one has written `warming up`. It has no deadline. */
export async function aStubStarted(): Promise<void> {
  while ((await stubPids()).length === 0) {
    await sleep(pollIntervalMs);
  }
}
