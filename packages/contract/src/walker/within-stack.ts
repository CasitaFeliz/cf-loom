/** What an engine writes when a run exhausts the call stack: V8's, which JavaScriptCore ends in a period, or SpiderMonkey's. */
const overflowMessage = /^(?:Maximum call stack size exceeded\.?|too much recursion)$/;

/**
 * What `run` returns, or nothing when it exhausted the call stack, whose bound is no number cf-loom
 * chooses: a `RangeError` (V8, JavaScriptCore) or an `InternalError` (SpiderMonkey, no global
 * elsewhere, so by name) with an engine's overflow message. Any other throw is rethrown, a
 * `RangeError` with another message included.
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

function isStackExhaustion(thrown: unknown): boolean {
  const isEngineError =
    thrown instanceof RangeError || (thrown instanceof Error && thrown.name === 'InternalError');
  return isEngineError && overflowMessage.test(thrown.message);
}
