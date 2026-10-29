import { defineProject } from 'vitest/config';
import { startDeadlineMs, stopTimeoutMs } from './test/test-process.ts';

/** A test or hook that starts a server waits for it to listen up to its start deadline, then for it to stop. */
const serverTimeout = startDeadlineMs + stopTimeoutMs;

export default defineProject({
  test: {
    name: '@cf-loom/messaging',
    testTimeout: serverTimeout,
    hookTimeout: serverTimeout,
  },
});
