import { defineProject } from 'vitest/config';
import { contractTimeout, heavyTestFiles } from './vitest.config.ts';

/** The heap limit in megabytes of a heavy test process, for the few files whose live data does not fit the light budget; two of them at once fit a CI runner. */
export const heavyHeapMegabytes = 2048;

/** How many heavy test processes run at once, in a group after the light projects, since Vitest refuses two projects of one group with different `maxWorkers`. */
const heavyWorkers = 2;

export default defineProject({
  test: {
    name: '@cf-loom/contract-heavy',
    include: [heavyTestFiles],
    testTimeout: contractTimeout,
    execArgv: [`--max-old-space-size=${heavyHeapMegabytes}`],
    maxWorkers: heavyWorkers,
    sequence: { groupOrder: 1 },
  },
});
