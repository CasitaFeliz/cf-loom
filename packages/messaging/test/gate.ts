import { onTestFinished } from 'vitest';

/** A promise a test settles itself, to hold a Handler or a call while it runs; opened when the test ends, so a failing test never leaves one held. */
export function aGate() {
  const gate = Promise.withResolvers<undefined>();
  const open = () => gate.resolve(undefined);
  onTestFinished(open);
  return { opened: gate.promise, open };
}
