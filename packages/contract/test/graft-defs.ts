import type { Defs, FormerInput, RefNode, SchemaNode } from '../src/internal/index.ts';
import { edgesOf, sortedEntries } from './graft-sites.ts';

/** The def a `ref` stands for through alias defs, nullable when a `ref` on the way is: a plain loop. */
export function destinationOf(
  ref: RefNode,
  defs: Defs,
): { name: string; def: SchemaNode; nullable: boolean } | undefined {
  const followed = new Set<string>();
  let nullable = false;
  for (let current: RefNode = ref; ; ) {
    if (!Object.hasOwn(defs, current.name) || followed.has(current.name)) {
      return undefined;
    }
    const def = defs[current.name] as SchemaNode;
    followed.add(current.name);
    nullable ||= current.nullable === true;
    if (def.type !== 'ref') {
      return { name: current.name, def, nullable };
    }
    current = def;
  }
}

/** A value as text, its keys in code point order. */
export function textOf(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(textOf).join(',')}]`;
  }
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  const entries = sortedEntries(value as Record<string, unknown>);
  return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${textOf(inner)}`).join(',')}}`;
}

/** The nodes inside a node in a fixed order, so two nodes with the same shell pair up one to one. */
export function innerOf(node: SchemaNode): readonly SchemaNode[] {
  return edgesOf(node).map(({ child }) => child);
}

/** A `ref`'s own annotations: the node without the def it names and its nullability. */
export function annotationsOf(ref: RefNode): Readonly<Record<string, unknown>> {
  const { name: _name, nullable: _nullable, ...annotations } = ref;
  return annotations;
}

/** The names of the defs the nodes reach, through `ref`s, by a plain loop over the graph. */
export function namesReachedBy(nodes: readonly SchemaNode[], defs: Defs): ReadonlySet<string> {
  const reached = new Set<string>();
  const pending = [...nodes];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'ref') {
      if (!reached.has(next.name) && Object.hasOwn(defs, next.name)) {
        reached.add(next.name);
        pending.push(defs[next.name] as SchemaNode);
      }
      continue;
    }
    for (const inner of innerOf(next)) {
      pending.push(inner);
    }
  }
  return reached;
}

/** What is wrong with the defs a former Input holds: not exactly those it reaches, or a name apart that is no def other than an alias. */
export function problemWithDefsOf(former: Pick<FormerInput, 'input' | 'defs'>): string | undefined {
  const { query, body } = former.input;
  const reached = namesReachedBy(body === null ? [query] : [query, body], former.defs);
  const held = Object.keys(former.defs).sort();
  if (textOf(held) !== textOf([...reached].sort())) {
    return `holds ${textOf(held)} and reaches ${textOf([...reached].sort())}`;
  }
  const apart = held.filter((name) => name.includes('~'));
  const alias = apart.find((name) => (former.defs[name] as SchemaNode).type === 'ref');
  return alias === undefined ? undefined : `${alias} is named apart and is an alias`;
}

/** Whether a def and every def it reaches are the same text in two graphs, by a plain loop. */
export function isClosureUnchanged(name: string, from: Defs, to: Defs): boolean {
  const ref: SchemaNode = { type: 'ref', name };
  const reached = namesReachedBy([ref], from);
  if (textOf([...reached].sort()) !== textOf([...namesReachedBy([ref], to)].sort())) {
    return false;
  }
  return [...reached, name].every((held) => textOf(from[held]) === textOf(to[held]));
}
