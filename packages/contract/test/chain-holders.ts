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

/** The types of the nodes in `node` that hold a `ref` to `name` directly, never following a `ref`. */
function holdersIn(node: Node, name: string): string[] {
  const holders: string[] = [];
  for (const held of nodesBelow(node)) {
    if (isRefTo(held, name)) {
      holders.push(node.type);
    } else if (held.type !== 'ref') {
      for (const holder of holdersIn(held, name)) {
        holders.push(holder);
      }
    }
  }
  return holders;
}

/**
 * The types of the nodes that hold the link before link `index` in its def: the def itself when it
 * is the `ref` to that link, and every node in it with that `ref` as a step of its own.
 */
export function holdingTypesOf(declared: ServiceSnapshot, index: number): string[] {
  const def = declared.defs[`link${index}`];
  const before = `link${index - 1}`;
  if (def === undefined) {
    return [];
  }
  return isRefTo(def, before) ? ['ref'] : holdersIn(def, before);
}
