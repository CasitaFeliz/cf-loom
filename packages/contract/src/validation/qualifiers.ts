import { chainDown, fieldStep, indexStep, type Step, type StepChain } from '../walker/index.ts';
import { isPlainObject } from '../written/index.ts';

/**
 * The keys of a Qualifier that its schema's parse dropped, each as the chain of steps from `from`,
 * the Qualifier's own chain, down to it: a field step for an object's key, an index step for a
 * list's position, each chain sharing the chain of the container above it. `parsed` is what zod
 * made of `value`, and a walked schema transforms nothing, so only the stripped keys differ.
 */
export function strippedKeysOf(
  value: unknown,
  parsed: unknown,
  from: StepChain,
): readonly StepChain[] {
  const stripped: StepChain[] = [];
  const onPath = new Set<object>();
  const frames: Comparing[] = [];
  open(frames, onPath, { chain: from, value, parsed });
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const pair = frame.pairs[frame.next++];
    if (pair === undefined) {
      frames.pop();
      onPath.delete(frame.value);
      continue;
    }
    const chain = chainDown(frame.chain, [pair.step]);
    if (!pair.isKept) {
      stripped.push(chain);
    } else if (!isOnPath(onPath, pair.value)) {
      open(frames, onPath, { chain, value: pair.value, parsed: pair.parsed });
    }
  }
  return stripped;
}

/** A member of the value beside what the parse made of it, and whether the parse kept its key. */
type Pair = {
  readonly step: Step;
  readonly value: unknown;
  readonly parsed: unknown;
  readonly isKept: boolean;
};

/** A container of the value, where it sits, whose members are being compared, and how many have been. */
type Comparing = {
  readonly chain: StepChain;
  readonly value: object;
  readonly pairs: readonly Pair[];
  next: number;
};

/** A container of the value and what the parse made of it, at the chain it sits at. */
type Container = { readonly chain: StepChain; readonly value: unknown; readonly parsed: unknown };

/** Opens a container of the value, which the walk does not enter again below itself. */
function open(frames: Comparing[], onPath: Set<object>, { chain, value, parsed }: Container): void {
  const pairs = pairsOf(value, parsed);
  if (pairs.length === 0 || typeof value !== 'object' || value === null) {
    return;
  }
  onPath.add(value);
  frames.push({ chain, value, pairs, next: 0 });
}

function isOnPath(onPath: ReadonlySet<object>, value: unknown): boolean {
  return typeof value === 'object' && value !== null && onPath.has(value);
}

function pairsOf(value: unknown, parsed: unknown): readonly Pair[] {
  if (Array.isArray(value) && Array.isArray(parsed)) {
    return Object.entries(value).map(([key, item]) => ({
      step: indexStep(Number(key)),
      value: item,
      parsed: parsed[Number(key)],
      isKept: true,
    }));
  }
  if (!isPlainObject(value) || !isPlainObject(parsed)) {
    return [];
  }
  return Object.entries(value).map(([key, member]) => ({
    step: fieldStep(key),
    value: member,
    parsed: parsed[key],
    isKept: Object.hasOwn(parsed, key),
  }));
}
