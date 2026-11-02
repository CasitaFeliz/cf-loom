/** What V8 throws in a `RangeError` when a run exhausts the call stack, which JavaScriptCore ends in a period. */
const rangeErrorOverflow = /^Maximum call stack size exceeded\.?$/;

/** What SpiderMonkey throws in an `InternalError`, no global outside Firefox, so named by its `name`. */
const internalErrorOverflow = 'too much recursion';

/**
 * What `run` returns, or nothing when it exhausted the call stack, whose bound is no number cf-loom
 * chooses; any other throw is rethrown.
 */
export function withinStack<Value>(run: () => Value): Value | undefined {
  try {
    return run();
  } catch (e) {
    if (isStackExhaustion(e)) {
      return undefined;
    }
    throw e;
  }
}

/**
 * Whether a throw is an engine's call stack exhausted, the class and message each engine pairs: a
 * `RangeError` with V8's message, or an error named `InternalError` with SpiderMonkey's. A throw
 * that cannot be read is none, so it is rethrown as it was thrown.
 */
function isStackExhaustion(thrown: unknown): boolean {
  try {
    if (!(thrown instanceof Error) || typeof thrown.message !== 'string') {
      return false;
    }
    if (thrown instanceof RangeError) {
      return rangeErrorOverflow.test(thrown.message);
    }
    return thrown.message === internalErrorOverflow && thrown.name === 'InternalError';
  } catch {
    return false;
  }
}
