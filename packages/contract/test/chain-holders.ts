import type { ServiceSnapshot } from '../src/internal/index.ts';

/** A schema node as a Snapshot holds it: an object with a text `type`. */
type Node = { readonly type: string; readonly name?: string };

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

/** The types of the nodes on the way from `node` down to each `ref` to `name` below it, never following a `ref`. */
function typesOnTheWayIn(node: Node, name: string): string[] {
  const types: string[] = [];
  for (const held of nodesBelow(node)) {
    const below = isRefTo(held, name) ? [] : typesOnTheWayIn(held, name);
    if (isRefTo(held, name) || below.length > 0) {
      types.push(node.type);
    }
    for (const type of below) {
      types.push(type);
    }
  }
  return types;
}

/**
 * The types of the nodes the def of link `index` holds the link before through: the def itself when
 * it is the `ref` to that link, and every node on the way from the def to that `ref` otherwise.
 */
export function holdingTypesOf(declared: ServiceSnapshot, index: number): string[] {
  const def = declared.defs[`link${index}`];
  const before = `link${index - 1}`;
  if (def === undefined) {
    return [];
  }
  return isRefTo(def, before) ? ['ref'] : typesOnTheWayIn(def, before);
}
