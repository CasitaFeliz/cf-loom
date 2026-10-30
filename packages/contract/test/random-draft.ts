/** A node or any JSON value of a graph, read and edited in place. */
export type Draft = {
  type?: unknown;
  name?: unknown;
  key?: unknown;
  fields?: unknown;
  items?: unknown;
  options?: unknown;
  min?: unknown;
  required?: unknown;
  nullable?: unknown;
  description?: unknown;
  [key: string]: unknown;
};

/** A graph's defs and exports as drafts. */
export type DraftGraph = { defs: Record<string, Draft>; exports: Record<string, Draft> };

/** A seeded generator of numbers below 1. */
export type Next = () => number;

/** The values a Neutral annotation is drawn from, so a draw often meets an annotation equal to another. */
export const neutralValues = {
  description: ['x', 'y'],
  examples: [['x'], ['y']],
  origin: ['local', '@org/definitions@1.0.0#m'],
} as const;

export type NeutralName = keyof typeof neutralValues;

export const neutralNames = Object.keys(neutralValues) as readonly NeutralName[];

/** The items once each, in the order a Snapshot holds an `allOf`'s: by their shapes as text. */
export function inShapeOrder<Item>(items: readonly Item[]): Item[] {
  const byText = new Map(items.map((item) => [shapeTextOf(item), item]));
  return [...byText.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, item]) => item);
}

export function shapeTextOf(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(shapeTextOf).join(',')}]`;
  }
  if (typeof value !== 'object' || value === null) {
    return JSON.stringify(value);
  }
  const isNode = 'type' in value;
  const keys = Object.keys(value)
    .filter((key) => !(isNode && key in neutralValues))
    .sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${shapeTextOf(Reflect.get(value, key))}`,
  );
  return `{${entries.join(',')}}`;
}

/** Every node inside a value, the value itself included when it is one. */
export function nodesIn(value: unknown, found: Draft[] = []): Draft[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      nodesIn(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    if ('type' in value && typeof value.type === 'string') {
      found.push(value as Draft);
    }
    for (const inner of Object.values(value)) {
      nodesIn(inner, found);
    }
  }
  return found;
}

/** One of the items drawn, none when there are none. */
export function pickFrom<Item>(items: readonly Item[], next: Next): Item | undefined {
  return items[Math.floor(next() * items.length)];
}

/** One of the items drawn; none to draw from is a bug. */
export function drawFrom<Item>(items: readonly Item[], next: Next): Item {
  const item = pickFrom(items, next);
  if (item === undefined) {
    throw new Error('An edit drew from nothing: a bug.');
  }
  return item;
}

export function isRef(node: Draft): boolean {
  return node.type === 'ref';
}

/** The key nodes of the records among the nodes, which must stay strings. */
export function keysOf(nodes: Draft[]): Set<unknown> {
  return new Set(nodes.filter((node) => node.type === 'record').map((node) => node.key));
}
