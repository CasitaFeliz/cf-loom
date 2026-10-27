import type { NotAllowedFailure } from '../validation/index.ts';
import type { Path, Site } from '../walker/index.ts';
import { ownOf } from '../written/index.ts';

/** The deepest JSON nesting a Snapshot may hold, so whatever `generate` writes the decoder reads back. */
export const snapshotNestingLimit = 256;

/** The level a def sits at once a removed code holds it: below the root, `codes`, a code and its `defs`. */
const removedCodeDefDepth = 5;

/**
 * A Snapshot `generate` would write nested deeper than the decoder reads back, refused at the
 * Element the too-deep value sits in, since the inner path is no author's term.
 */
export function nestingFailureOf(snapshot: unknown): NotAllowedFailure | undefined {
  const at = tooDeepPathOf(snapshot);
  if (at === undefined) {
    return undefined;
  }
  const construct = `JSON nested deeper than the ${snapshotNestingLimit} levels a Snapshot holds`;
  const site = siteOfPath(snapshot, at);
  return {
    kind: 'not-allowed',
    site,
    steps: [],
    construct,
    declaration: undefined,
    alsoIn: [],
    origin: undefined,
  };
}

/** The Element a path into a Snapshot leads into: its top-level entry, by the key it sits under. */
function siteOfPath(snapshot: unknown, [section, key]: Path): Site {
  if (typeof key !== 'string') {
    return { kind: 'root' };
  }
  switch (section) {
    case 'endpoints': {
      const name = ownOf(ownOf(ownOf(snapshot, 'endpoints'), key), 'name');
      return { kind: 'endpoint', identity: key, name: typeof name === 'string' ? name : key };
    }
    case 'events':
      return { kind: 'event', identity: key };
    case 'commands':
      return { kind: 'command', identity: key };
    case 'codes':
      return { kind: 'code', code: key };
    case 'guards':
      return { kind: 'guard', name: key };
    case 'exports':
      return { kind: 'export', name: key };
    case 'defs':
      return { kind: 'def', name: key };
    default:
      return { kind: 'root' };
  }
}

/** A JSON object or array, and where it sits, at its depth of nesting. */
type Container = { readonly value: object; readonly at: Path; readonly depth: number };

/** Where a value sits in a Snapshot, and at which level, the outermost value being level 1. */
type Root = { readonly at: Path; readonly depth: number };

/**
 * The path of the first object or array nested deeper than a Snapshot may, the outermost value
 * being level 1 and each def counted where a removed code holds it; `undefined` when none.
 */
export function tooDeepPathOf(json: unknown): Path | undefined {
  return pathBeyondLimitFrom(json, { at: [], depth: 1 }) ?? defPathBeyondLimitIn(json);
}

/** The path of the first def that nests past the limit once a removed code holds it. */
function defPathBeyondLimitIn(snapshot: unknown): Path | undefined {
  const defs = ownOf(snapshot, 'defs');
  for (const [name, def] of isContainer(defs) ? Object.entries(defs) : []) {
    const at = pathBeyondLimitFrom(def, { at: ['defs', name], depth: removedCodeDefDepth });
    if (at !== undefined) {
      return at;
    }
  }
  return undefined;
}

/**
 * The first container past the limit below a value at `root`, read without recursion so no depth
 * can overflow the stack.
 */
function pathBeyondLimitFrom(json: unknown, root: Root): Path | undefined {
  if (!isContainer(json)) {
    return undefined;
  }
  const pending: Container[] = [{ value: json, ...root }];
  for (let container = pending.pop(); container !== undefined; container = pending.pop()) {
    if (container.depth > snapshotNestingLimit) {
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
