import type { Path } from '../walker/index.ts';

/** The deepest JSON nesting a Snapshot may hold, so whatever `generate` writes the decoder reads back. */
export const snapshotNestingLimit = 256;

/** A JSON object or array, and where it sits, at its depth of nesting. */
type Container = { readonly value: object; readonly at: Path; readonly depth: number };

/**
 * The path of the first object or array nested deeper than `limit` levels, the outermost value
 * being level 1, read without recursion so no depth can overflow the stack; `undefined` when none.
 */
export function deepestPathOf(json: unknown, limit: number): Path | undefined {
  if (!isContainer(json)) {
    return undefined;
  }
  const pending: Container[] = [{ value: json, at: [], depth: 1 }];
  for (let container = pending.pop(); container !== undefined; container = pending.pop()) {
    if (container.depth > limit) {
      return container.at;
    }
    pending.push(...childrenOf(container));
  }
  return undefined;
}

/** The objects and arrays a container holds, the first last, so the first is read next. */
function childrenOf({ value, at, depth }: Container): readonly Container[] {
  const entries: readonly (readonly [string | number, unknown])[] = Array.isArray(value)
    ? value.map((item, index) => [index, item] as const)
    : Object.entries(value);
  const children: Container[] = [];
  for (const [key, child] of entries) {
    if (isContainer(child)) {
      children.push({ value: child, at: [...at, key], depth: depth + 1 });
    }
  }
  return children.reverse();
}

function isContainer(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
