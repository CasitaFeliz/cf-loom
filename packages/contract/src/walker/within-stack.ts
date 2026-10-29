/**
 * What `run` returns, or nothing when it threw a `RangeError`, as zod does when a run overflows the
 * call stack, whose bound is no number cf-loom chooses; any other throw is rethrown.
 */
export function withinStack<Value>(run: () => Value): Value | undefined {
  try {
    return run();
  } catch (e) {
    if (e instanceof RangeError) {
      return undefined;
    }
    throw e;
  }
}
