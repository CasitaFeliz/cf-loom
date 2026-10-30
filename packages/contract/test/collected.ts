import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

const passes = 3;

/**
 * Collects whatever nothing reaches: three full garbage collections, each followed by a macrotask
 * so finalizers and `WeakRef`s settle between them. The collector is reached by turning on
 * `--expose-gc` at run time and reading `gc` in a fresh context, which works in every Vitest pool,
 * where a worker thread refuses the flag on the command line.
 */
export async function collected(): Promise<void> {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  for (let pass = 0; pass < passes; pass++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
