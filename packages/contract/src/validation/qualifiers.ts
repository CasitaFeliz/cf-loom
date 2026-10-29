import { isPlainObject } from '../written/index.ts';

/**
 * The keys of a Qualifier that its schema's parse dropped, as dotted paths: `parsed` is what zod
 * made of `value`, and a walked schema transforms nothing, so only the stripped keys differ.
 */
export function strippedKeysOf(value: unknown, parsed: unknown): readonly string[] {
  const stripped: string[] = [];
  const onPath = new Set<object>();
  const frames: Comparing[] = [];
  open(frames, onPath, { key: '', value, parsed, isKept: true });
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const pair = frame.pairs[frame.next++];
    if (pair === undefined) {
      frames.pop();
      onPath.delete(frame.value);
      continue;
    }
    if (!pair.isKept) {
      stripped.push(pathOf(frames, pair.key));
    } else if (!isOnPath(onPath, pair.value)) {
      open(frames, onPath, pair);
    }
  }
  return stripped;
}

/** A member of the value beside what the parse made of it, and whether the parse kept its key. */
type Pair = {
  readonly key: string;
  readonly value: unknown;
  readonly parsed: unknown;
  readonly isKept: boolean;
};

/** A container of the value whose members are being compared, and how many have been. */
type Comparing = {
  readonly key: string;
  readonly value: object;
  readonly pairs: readonly Pair[];
  next: number;
};

/** Opens a container of the value, which the walk does not enter again below itself. */
function open(frames: Comparing[], onPath: Set<object>, { key, value, parsed }: Pair): void {
  const pairs = pairsOf(value, parsed);
  if (pairs.length === 0 || typeof value !== 'object' || value === null) {
    return;
  }
  onPath.add(value);
  frames.push({ key, value, pairs, next: 0 });
}

function isOnPath(onPath: ReadonlySet<object>, value: unknown): boolean {
  return typeof value === 'object' && value !== null && onPath.has(value);
}

function pairsOf(value: unknown, parsed: unknown): readonly Pair[] {
  if (Array.isArray(value) && Array.isArray(parsed)) {
    return Object.entries(value).map(([key, item]) => ({
      key,
      value: item,
      parsed: parsed[Number(key)],
      isKept: true,
    }));
  }
  if (!isPlainObject(value) || !isPlainObject(parsed)) {
    return [];
  }
  return Object.entries(value).map(([key, member]) => ({
    key,
    value: member,
    parsed: parsed[key],
    isKept: Object.hasOwn(parsed, key),
  }));
}

/** A key's dotted path: the keys of the containers open below the outermost, then its own. */
function pathOf(frames: readonly Comparing[], key: string): string {
  const keys = frames.slice(1).map((frame) => frame.key);
  return [...keys, key].join('.');
}
