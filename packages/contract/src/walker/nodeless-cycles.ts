import type { SchemaNode } from './nodes.ts';

/**
 * The defs that lead back to themselves through `ref`s, `union` options and `allOf` items alone,
 * with no other node between, which zod's parse never ends on, found once for the defs, so the
 * time grows with the defs and their nodes. A `ref` to a name with no def leads nowhere.
 */
export function defsLeadingBackWithNoNodeOf(
  defs: ReadonlyMap<string, SchemaNode>,
): ReadonlySet<string> {
  return cycleMembersFrom(defs.keys(), (name) => defs.get(name));
}

/**
 * Whether a def leads back to itself through `ref`s, `union` options and `allOf` items alone,
 * with no other node between, which zod's parse never ends on; a `ref` to a name with no def
 * leads nowhere. The def need not be among `defs` yet, as when the walk writes it.
 */
export function leadsBackWithNoNode(
  name: string,
  def: SchemaNode,
  defs: ReadonlyMap<string, SchemaNode>,
): boolean {
  const defOf = (other: string) => (other === name ? def : defs.get(other));
  return cycleMembersFrom([name], defOf).has(name);
}

/** What the search has read: the order it met each def in, and the lowest order each can step back to. */
type Search = {
  readonly defOf: (name: string) => SchemaNode | undefined;
  readonly order: Map<string, number>;
  /** Kept only for the defs of a group still open, which is how the search tells one. */
  readonly lowest: Map<string, number>;
  readonly open: string[];
  readonly onCycle: Set<string>;
};

/** A def being read, with the defs it steps to and how many of them are read. */
type Frame = { readonly name: string; readonly targets: readonly string[]; next: number };

/**
 * Every def on a cycle of the steps with no node between, among those reached from the starts:
 * a strongly connected group of two or more, or a def stepping to itself; read with an explicit
 * stack, one frame per def, and a name `defOf` gives no def for leads nowhere.
 */
function cycleMembersFrom(
  starts: Iterable<string>,
  defOf: (name: string) => SchemaNode | undefined,
): ReadonlySet<string> {
  const search: Search = {
    defOf,
    order: new Map(),
    lowest: new Map(),
    open: [],
    onCycle: new Set(),
  };
  for (const start of starts) {
    if (!search.order.has(start)) {
      readFrom(start, search);
    }
  }
  return search.onCycle;
}

function readFrom(start: string, search: Search): void {
  const frames = [enter(start, search)];
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const target = frame.targets[frame.next++];
    if (target !== undefined) {
      const entered = stepTo(frame, target, search);
      if (entered !== undefined) {
        frames.push(entered);
      }
      continue;
    }
    frames.pop();
    close(frame, frames.at(-1), search);
  }
}

/** Meets a def for the first time: its place in the order, and the defs it steps to that have a def. */
function enter(name: string, search: Search): Frame {
  const order = search.order.size;
  search.order.set(name, order);
  search.lowest.set(name, order);
  search.open.push(name);
  const def = search.defOf(name);
  const steps = def === undefined ? [] : nodelessDefsFrom(def);
  return { name, targets: steps.filter((step) => search.defOf(step) !== undefined), next: 0 };
}

/** Reads one step of a def: a def met for the first time is entered, one in an open group lowers the def's reach. */
function stepTo(frame: Frame, target: string, search: Search): Frame | undefined {
  if (target === frame.name) {
    search.onCycle.add(target);
    return undefined;
  }
  if (!search.order.has(target)) {
    return enter(target, search);
  }
  if (search.lowest.has(target)) {
    lowerTo(frame.name, search.order.get(target), search);
  }
  return undefined;
}

function lowerTo(name: string, reach: number | undefined, search: Search): void {
  const lowest = search.lowest.get(name);
  if (lowest !== undefined && reach !== undefined && reach < lowest) {
    search.lowest.set(name, reach);
  }
}

/** A def read to its last step passes its reach to the def that stepped to it, and closes its group when it is the group's first. */
function close(frame: Frame, parent: Frame | undefined, search: Search): void {
  if (parent !== undefined) {
    lowerTo(parent.name, search.lowest.get(frame.name), search);
  }
  if (search.lowest.get(frame.name) !== search.order.get(frame.name)) {
    return;
  }
  const group: string[] = [];
  for (let member = search.open.pop(); member !== undefined; member = search.open.pop()) {
    search.lowest.delete(member);
    group.push(member);
    if (member === frame.name) {
      break;
    }
  }
  if (group.length > 1) {
    for (const member of group) {
      search.onCycle.add(member);
    }
  }
}

/** The def names a def's `ref`s name with no node between, through options and items, each once. */
function nodelessDefsFrom(def: SchemaNode): readonly string[] {
  const names = new Set<string>();
  const pending = [def];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'ref') {
      names.add(node.name);
      continue;
    }
    for (const step of nodelessStepsFrom(node)) {
      pending.push(step);
    }
  }
  return [...names];
}

/** The nodes a path with no node between steps to from a node that is no `ref`: options or items. */
function nodelessStepsFrom(node: SchemaNode): readonly SchemaNode[] {
  switch (node.type) {
    case 'union':
      return node.options;
    case 'allOf':
      return node.items;
    case 'ref':
    case 'string':
    case 'number':
    case 'boolean':
    case 'enum':
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'tagged':
    case 'json':
      return [];
  }
}
