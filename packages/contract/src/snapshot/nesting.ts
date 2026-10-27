import type { NotAllowedFailure } from '../validation/index.ts';
import type { Path, Site } from '../walker/index.ts';
import { ownOf } from '../written/index.ts';
import { defScopesOf } from './def-scopes.ts';
import type { PublishedSnapshot } from './published.ts';
import type { Snapshot } from './types.ts';

/** The deepest JSON nesting a file may hold, which the decoder reads without overflowing its stack. */
export const snapshotNestingLimit = 256;

/**
 * The deepest a schema node may nest, its root the first. A node's root sits at most 4 keys below
 * the outermost object, so a Snapshot whose nodes all keep it stays within `snapshotNestingLimit`
 * wherever the merge keeps a node.
 */
export const nodeNestingLimit = 252;

/**
 * A schema `generate` would write nested deeper than the decoder reads back, refused at the Element
 * the too-deep value sits in, since the inner path is no author's term.
 */
export function nestingFailureOf(snapshot: Snapshot): NotAllowedFailure | undefined {
  const at = tooDeepNodePathOf(snapshot);
  if (at === undefined) {
    return undefined;
  }
  const construct = `a schema nested deeper than the ${nodeNestingLimit} levels a Snapshot holds`;
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

/** Where a value sits, and the level it counts as, the outermost value of what is judged being level 1. */
type Root = { readonly at: Path; readonly depth: number };

/** The path of the first schema node of a Snapshot nested deeper than `nodeNestingLimit`. */
export function tooDeepNodePathOf(snapshot: Snapshot | PublishedSnapshot): Path | undefined {
  if (snapshot.kind === 'application') {
    return undefined;
  }
  for (const { nodes } of defScopesOf(snapshot)) {
    for (const { at, node } of nodes) {
      const deep = pathBeyondLimitFrom(node, { at, depth: 1 }, nodeNestingLimit);
      if (deep !== undefined) {
        return deep;
      }
    }
  }
  return undefined;
}

/**
 * The path of the first object or array nested deeper than a Snapshot may, the outermost value
 * being level 1, read without recursion so no depth can overflow the stack; `undefined` when none.
 */
export function tooDeepPathOf(json: unknown): Path | undefined {
  return pathBeyondLimitFrom(json, { at: [], depth: 1 }, snapshotNestingLimit);
}

/** The first container below a value at `root` deeper than `limit`, read without recursion. */
function pathBeyondLimitFrom(json: unknown, root: Root, limit: number): Path | undefined {
  if (!isContainer(json)) {
    return undefined;
  }
  const pending: Container[] = [{ value: json, ...root }];
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
