import { defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';
import { growthTestFiles } from './vitest.config.ts';

/**
 * The heap limit in megabytes of a growth test process: the family's largest chain process peaked at
 * 1,534 MB of used heap with two at once and 1,745 MB with three, sampled every 50 ms and so
 * including garbage not yet collected, and 2,048 leaves 17% above the largest. It is the heavy
 * class's value by measurement, not by reference, since the two classes may move apart.
 */
export const growthHeapMegabytes = 2048;

/**
 * How many growth test processes run at once: two at their limit fit a CI runner as the heavy
 * class's do, while three at 2,048 MB each would pass a runner's share of its memory.
 */
const growthWorkers = 2;

/**
 * The group the growth project runs in, one of its own after the heavy one's, so a run of every
 * project runs the growth files apart from heavy's and either class's workers can change: Vitest
 * refuses two projects of one group with different `maxWorkers`.
 */
const growthGroup = 2;

export default defineProject({
  test: {
    name: '@cf-loom/contract-growth',
    include: [growthTestFiles],
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
    execArgv: [`--max-old-space-size=${growthHeapMegabytes}`],
    maxWorkers: growthWorkers,
    sequence: { groupOrder: growthGroup },
  },
});
