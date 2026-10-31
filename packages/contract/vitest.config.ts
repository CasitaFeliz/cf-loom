import { defineProject } from 'vitest/config';

/**
 * Many tests walk, compare or decode thousands of schemas, or check generated histories, which a CI
 * runner that several runs share stretches several times over. A test whose purpose is a time bound
 * measures CPU time or growth instead.
 */
const heavyTimeout = 60_000;

/** A worker's old space is capped well under V8's default, which grows to about 4 GB on most hosts, so that the collector runs before a runner's memory limit kills the worker. */
const workerHeapMegabytes = 2048;

export default defineProject({
  test: {
    name: '@cf-loom/contract',
    testTimeout: heavyTimeout,
    execArgv: [`--max-old-space-size=${workerHeapMegabytes}`],
  },
});
