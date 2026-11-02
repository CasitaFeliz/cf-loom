import type { Defs, FormerInput, SchemaNode } from '../src/internal/index.ts';
import { annotationsOf, destinationOf, innerOf, textOf } from './graft-defs.ts';
import { sortedEntries } from './graft-sites.ts';

/** What stands in a node's text for the nodes inside it, which are compared on their own. */
function placeholdersOf(node: SchemaNode): Readonly<Record<string, unknown>> {
  switch (node.type) {
    case 'object':
      return { fields: sortedEntries(node.fields).map(([name, { required }]) => [name, required]) };
    case 'array':
      return { items: 0 };
    case 'record':
      return { key: 0, value: 0 };
    case 'tuple':
      return { items: node.items.length, rest: node.rest === undefined ? undefined : 0 };
    case 'union':
      return { options: node.options.length };
    case 'allOf':
      return { items: node.items.length };
    case 'tagged':
      return { variants: sortedEntries(node.variants).map(([value]) => value) };
    default:
      return {};
  }
}

/** A node as text with each node inside it left out, so two nodes compare by what they hold themselves. */
function shellOf(node: SchemaNode): string {
  return textOf({ ...node, ...placeholdersOf(node) });
}

/** The state of one comparison: the defs on each side, the pairs of defs assumed to match, and the first difference found. */
type Comparison = {
  readonly baseline: Defs;
  readonly former: Defs;
  assumed: Set<string>;
  failure: string | undefined;
};

/** Two nodes to compare, the first from the Input grafted from, and where they sit. */
type Pair = { readonly from: SchemaNode; readonly to: SchemaNode; readonly at: string };

function fail(comparison: Comparison, at: string, why: string): false {
  comparison.failure ??= `${at}: ${why}`;
  return false;
}

/** Runs a comparison that may fail, and leaves the assumptions and the failure as they were when it does. */
function trial(comparison: Comparison, run: () => boolean): boolean {
  const assumed = new Set(comparison.assumed);
  const failure = comparison.failure;
  const holds = run();
  if (!holds) {
    comparison.assumed = assumed;
    comparison.failure = failure;
  }
  return holds;
}

function sameRefs(comparison: Comparison, { from, to, at }: Pair): boolean {
  if (from.type !== 'ref' || to.type !== 'ref') {
    return fail(comparison, at, `${from.type} against ${to.type}`);
  }
  const original = destinationOf(from, comparison.baseline);
  const grafted = destinationOf(to, comparison.former);
  if (original === undefined || grafted === undefined) {
    return fail(comparison, at, 'a `ref` that reaches no def');
  }
  if (
    original.nullable !== grafted.nullable ||
    textOf(annotationsOf(from)) !== textOf(annotationsOf(to))
  ) {
    return fail(
      comparison,
      at,
      `the \`ref\` to ${original.name} differs from the one to ${grafted.name}`,
    );
  }
  const pair = `${original.name} ${grafted.name}`;
  if (comparison.assumed.has(pair)) {
    return true;
  }
  comparison.assumed.add(pair);
  return same(comparison, { from: original.def, to: grafted.def, at: `${at} > ${pair}` });
}

function sameItems(comparison: Comparison, from: readonly SchemaNode[], to: Pair): boolean {
  const unmatched = [...innerOf(to.to)];
  for (const item of from) {
    const found = unmatched.findIndex((candidate) =>
      trial(comparison, () => same(comparison, { from: item, to: candidate, at: to.at })),
    );
    if (found === -1) {
      return fail(comparison, to.at, 'an `allOf` item has no counterpart');
    }
    unmatched.splice(found, 1);
  }
  return true;
}

function same(comparison: Comparison, pair: Pair): boolean {
  const { from, to, at } = pair;
  if (from.type === 'ref' || to.type === 'ref') {
    return sameRefs(comparison, pair);
  }
  if (shellOf(from) !== shellOf(to)) {
    return fail(comparison, at, `${shellOf(from)} against ${shellOf(to)}`);
  }
  if (from.type === 'allOf') {
    return sameItems(comparison, from.items, pair);
  }
  const inner = innerOf(to);
  return innerOf(from).every((child, index) =>
    same(comparison, { from: child, to: inner[index] as SchemaNode, at: `${at}.${index}` }),
  );
}

/**
 * Where a former Input differs from the Input it was grafted from, `undefined` when it is that
 * Input up to the names of its defs: both read through alias defs, each `ref` by the def it
 * stands for and whether that is nullable, each pair of defs compared once, a node by what it
 * holds itself and then the nodes inside it, an `allOf`'s items in any order. Shares no code with
 * the graft.
 */
export function differenceFromInput(
  former: Pick<FormerInput, 'input' | 'defs'>,
  baseline: Pick<FormerInput, 'input' | 'defs'>,
): string | undefined {
  const comparison: Comparison = {
    baseline: baseline.defs,
    former: former.defs,
    assumed: new Set(),
    failure: undefined,
  };
  same(comparison, { from: baseline.input.query, to: former.input.query, at: 'query' });
  if (baseline.input.body !== null && former.input.body !== null) {
    same(comparison, { from: baseline.input.body, to: former.input.body, at: 'body' });
  }
  return comparison.failure;
}
