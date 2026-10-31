import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

const passes = 3;

/**
 * One full garbage collection. The collector is reached by turning on `--expose-gc` at run time
 * and reading `gc` in a fresh context, which works in every Vitest pool, where a worker thread
 * refuses the flag on the command line.
 */
export function collectGarbage(): void {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  gc();
}

/**
 * Collects whatever nothing reaches: three full garbage collections, each followed by a macrotask
 * so finalizers and `WeakRef`s settle between them.
 */
export async function collected(): Promise<void> {
  for (let pass = 0; pass < passes; pass++) {
    collectGarbage();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** How many of the objects `refs` refers to are still reachable. */
export function heldOf(refs: readonly WeakRef<object>[]): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}
