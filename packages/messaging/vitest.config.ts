import { defineProject } from 'vitest/config';
import { startDeadlineMs, stopTimeoutMs } from './test/test-process.ts';

/** What a test or hook that starts a server may take beyond a start that fails and a stop that ends in a kill. */
const margin = 1_000;
/** A test or hook that starts a server waits for it to listen up to its start deadline, then for it to stop. */
const serverTimeout = startDeadlineMs + stopTimeoutMs + margin;

export default defineProject({
  test: {
    name: '@cf-loom/messaging',
    testTimeout: serverTimeout,
    hookTimeout: serverTimeout,
  },
});
