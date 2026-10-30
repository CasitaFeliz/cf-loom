import { vi } from 'vitest';

/** The longest a timer can be set for; as a deadline it is none, since the test's own timeout ends the wait first. */
const noDeadline = 2 ** 31 - 1;

/** Waits until `check` stops throwing and returns what it returned; the running test's timeout bounds it. */
export function until<Result>(check: () => Result | Promise<Result>): Promise<Result> {
  return vi.waitFor(check, { interval: 50, timeout: noDeadline });
}
