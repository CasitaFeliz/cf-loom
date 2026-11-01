import type { ServiceSnapshot } from '../src/internal/index.ts';

/** A schema node as a Snapshot holds it: an object with a text `type`. */
type Node = { readonly type: string; readonly name?: string; readonly nullable?: boolean };

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string'
  );
}

/** The nodes a value holds directly: those below it with no node between, through a field, a list or a record. */
function nodesBelow(value: object): Node[] {
  const nodes: Node[] = [];
  for (const member of Object.values(value)) {
    if (isNode(member)) {
      nodes.push(member);
    } else if (typeof member === 'object' && member !== null) {
      for (const node of nodesBelow(member)) {
        nodes.push(node);
      }
    }
  }
  return nodes;
}

function isRefTo(node: unknown, name: string): boolean {
  return isNode(node) && node.type === 'ref' && node.name === name;
}

/** One way a def holds the link before it: the types of the nodes from the def down to the `ref`, and whether the `ref` admits null. */
export type Holding = { readonly types: readonly string[]; readonly nullable: boolean };

/** The holdings of `node` and the nodes below it, never following a `ref`, of the `ref`s to `name`; `above` are the types on the way to `node`. */
function holdingsIn(node: Node, name: string, above: readonly string[]): Holding[] {
  const types = [...above, node.type];
  const holdings: Holding[] = [];
  for (const held of nodesBelow(node)) {
    if (isRefTo(held, name)) {
      holdings.push({ types, nullable: held.nullable === true });
    } else if (held.type !== 'ref') {
      for (const holding of holdingsIn(held, name, types)) {
        holdings.push(holding);
      }
    }
  }
  return holdings;
}

/**
 * Every way the def of link `index` holds the link before it: the def itself when it is the `ref`
 * to that link, and each `ref` to it below the def otherwise.
 */
export function holdingsOf(declared: ServiceSnapshot, index: number): Holding[] {
  const def = declared.defs[`link${index}`];
  const before = `link${index - 1}`;
  if (def === undefined) {
    return [];
  }
  return isRefTo(def, before)
    ? [{ types: ['ref'], nullable: def.nullable === true }]
    : holdingsIn(def, before, []);
}

/**
 * Where a holding sits in a link of a chain whose node type is `type`: `inside` a node of that
 * type, `next` when the def is an object that holds the link before as its field `next`, or other.
 */
export function holdingKindOf(holding: Holding, type: string): 'inside' | 'next' | 'other' {
  if (holding.types.includes(type)) {
    return 'inside';
  }
  return holding.types.length === 1 && holding.types[0] === 'object' ? 'next' : 'other';
}
