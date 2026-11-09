import type { Defs, RefNode, SchemaNode, ShapeDifference } from '../src/internal/index.ts';
import { textOf } from './graft-defs.ts';

/** The defs of each side, which the `ref`s of that side name. */
export type Both = { readonly baseline: Defs; readonly proposed: Defs };

/** The Neutral annotations two nodes may differ in. */
export const annotations = ['description', 'examples', 'origin'] as const;

/** The name a `ref` carries, none for another node. */
export function nameOf(node: SchemaNode): string | undefined {
  return node.type === 'ref' ? node.name : undefined;
}

/** The text of a shape, its kind and what tells it from another of the kind. */
export function shapeTextOf(shape: ShapeDifference): string {
  switch (shape.kind) {
    case 'annotation-changed':
      return `annotation-changed(${shape.annotation})`;
    case 'field-added':
      return `field-added(${shape.required})`;
    case 'type-changed':
      return `type-changed(${shape.from}>${shape.to})`;
    default:
      return shape.kind;
  }
}

/** Whether a def and every def it reaches have the same text on both sides. */
export function isClosureSame(name: string, defs: Both): boolean {
  const seen = new Set<string>();
  const pending = [name];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    const baseline = defs.baseline[next];
    const proposed = defs.proposed[next];
    if (baseline === undefined || proposed === undefined || textOf(baseline) !== textOf(proposed)) {
      return false;
    }
    for (const [, held] of JSON.stringify(baseline).matchAll(/"name":"([^"]*)"/g)) {
      pending.push(held as string);
    }
  }
  return true;
}

/** Whether two nodes are `ref`s naming one def that, with every def it reaches, is the same text on both sides. */
export function areRefsToSameDef(baseline: SchemaNode, proposed: SchemaNode, defs: Both): boolean {
  return (
    baseline.type === 'ref' &&
    proposed.type === 'ref' &&
    baseline.name === proposed.name &&
    isClosureSame(baseline.name, defs)
  );
}

/** The def a `ref` stands for, through alias defs, by a plain loop. */
export function resolvedNameOf(ref: RefNode, defs: Defs): string {
  let name = ref.name;
  for (let def = defs[name]; def?.type === 'ref'; def = defs[name]) {
    name = def.name;
  }
  return name;
}

function oneHopOn(node: SchemaNode, defs: Defs): SchemaNode {
  return node.type === 'ref' ? (defs[node.name] as SchemaNode) : node;
}

function differsInItself(baseline: SchemaNode, proposed: SchemaNode): boolean {
  return (
    nameOf(baseline) !== nameOf(proposed) ||
    annotations.some((name) => textOf(baseline[name]) !== textOf(proposed[name]))
  );
}

/** Whether an alias pair a hop from two `ref`s passes over, one hop at a time, has a finding of its own. */
export function hasAliasFinding(baseline: RefNode, proposed: RefNode, defs: Both): boolean {
  let pair = {
    baseline: oneHopOn(baseline, defs.baseline),
    proposed: oneHopOn(proposed, defs.proposed),
  };
  while (pair.baseline.type === 'ref' || pair.proposed.type === 'ref') {
    if (areRefsToSameDef(pair.baseline, pair.proposed, defs)) {
      return false;
    }
    if (differsInItself(pair.baseline, pair.proposed)) {
      return true;
    }
    pair = {
      baseline: oneHopOn(pair.baseline, defs.baseline),
      proposed: oneHopOn(pair.proposed, defs.proposed),
    };
  }
  return false;
}
