import { type DefGraph, defGraphOf } from './def-graph.ts';
import type { JudgedDefs, Outline } from './walked.ts';

/**
 * The defs that lead back to themselves through `ref`s, `union` options and `allOf` items alone,
 * with no other node between, which zod's parse never ends on, found once for the defs, so the
 * time grows with the defs and their nodes. A `ref` to a name with no def leads nowhere.
 */
export function defsLeadingBackWithNoNodeOf(defs: JudgedDefs): ReadonlySet<string> {
  return new Set(nodelessCyclesOf(defs).flat());
}

/**
 * Every nodeless cycle among the defs: the names of each strongly connected group of the steps
 * with no node between that holds two defs or more, or a def stepping to itself, which zod's
 * parse never ends on. A `ref` to a name the defs do not hold leads nowhere.
 */
export function nodelessCyclesOf(defs: JudgedDefs): readonly (readonly string[])[] {
  return cycleMembersFrom(defs);
}

/** A def met by the search: its order, the lowest order it steps back to, and its steps. */
type Entry = {
  readonly name: string;
  readonly index: number;
  low: number;
  isOpen: boolean;
  readonly steps: readonly string[];
  /** How many of the steps are read. */
  next: number;
  /** Whether one of its steps is the def itself. */
  isSelfStep: boolean;
};

type Search = {
  readonly def: DefGraph<Outline>['def'];
  readonly entries: Map<string, Entry>;
  /** The defs of the groups not closed yet, in the order they were met. */
  readonly open: Entry[];
  /** The groups that hold a cycle, each as the names of its defs. */
  readonly groups: string[][];
};

/**
 * Every strongly connected group of the steps with no node between among the defs that holds a
 * cycle: two defs or more, or a def stepping to itself; read with an explicit stack, one frame
 * per def, and a name with no def has no steps and leads nowhere.
 */
function cycleMembersFrom(defs: JudgedDefs): readonly (readonly string[])[] {
  const search: Search = { def: defGraphOf(defs).def, entries: new Map(), open: [], groups: [] };
  for (const start of Object.keys(defs)) {
    if (!search.entries.has(start)) {
      readFrom(start, search);
    }
  }
  return search.groups;
}

function readFrom(start: string, search: Search): void {
  const frames = [enter(start, search)];
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const step = frame.steps[frame.next++];
    if (step !== undefined) {
      const entered = stepTo(frame, step, search);
      if (entered !== undefined) {
        frames.push(entered);
      }
      continue;
    }
    frames.pop();
    const parent = frames.at(-1);
    if (parent !== undefined) {
      parent.low = Math.min(parent.low, frame.low);
    }
    closeGroup(frame, search);
  }
}

/** A def met for the first time, in an open group of its own. */
function enter(name: string, search: Search): Entry {
  const index = search.entries.size;
  const def = search.def(name);
  const steps = def === undefined ? [] : nodelessDefsFrom(def);
  const entry: Entry = { name, index, low: index, isOpen: true, steps, next: 0, isSelfStep: false };
  search.entries.set(name, entry);
  search.open.push(entry);
  return entry;
}

/** One step of a def: a def met first is entered, one in an open group is stepped back to. */
function stepTo(from: Entry, name: string, search: Search): Entry | undefined {
  if (name === from.name) {
    from.isSelfStep = true;
    return undefined;
  }
  const met = search.entries.get(name);
  if (met === undefined) {
    return enter(name, search);
  }
  if (met.isOpen) {
    from.low = Math.min(from.low, met.index);
  }
  return undefined;
}

/** A def that steps back to nothing above it closes its group: every def met since it. */
function closeGroup(entry: Entry, search: Search): void {
  if (entry.low !== entry.index) {
    return;
  }
  const group: Entry[] = [];
  for (let member = search.open.pop(); member !== undefined; member = search.open.pop()) {
    member.isOpen = false;
    group.push(member);
    if (member === entry) {
      break;
    }
  }
  if (group.length > 1 || entry.isSelfStep) {
    search.groups.push(group.map((member) => member.name));
  }
}

/** The def names a def's `ref`s name with no node between, through options and items, each once. */
function nodelessDefsFrom(def: Outline): readonly string[] {
  const names = new Set<string>();
  const pending: Outline[] = [def];
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

/** The nodes a path with no node between steps to from a node that is no `ref`. */
function nodelessStepsFrom(node: Outline): readonly Outline[] {
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
    case undefined:
      return [];
  }
}
