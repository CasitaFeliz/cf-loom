import type { ServiceSnapshot } from '../src/internal/index.ts';
import type { Holding } from './id-chain-type.ts';

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

function stepText(node: Node): string {
  return node.nullable === true ? `${node.type} (nullable)` : node.type;
}

/** A holding as text: its steps from the def down to the `ref`, joined, a nullable step marked. */
export function holdingText(holding: Holding): string {
  return holding
    .map((step) => (typeof step === 'string' ? step : `${step.type} (nullable)`))
    .join(' > ');
}

/** The steps from `node` down to each `ref` to `name` below it, never following a `ref`; `above` are the steps on the way to `node`. */
function pathsIn(node: Node, name: string, above: readonly string[]): string[][] {
  const here = [...above, stepText(node)];
  const paths: string[][] = [];
  for (const held of nodesBelow(node)) {
    if (isRefTo(held, name)) {
      paths.push([...here, stepText(held)]);
    } else if (held.type !== 'ref') {
      for (const path of pathsIn(held, name, here)) {
        paths.push(path);
      }
    }
  }
  return paths;
}

/**
 * Every way the def of link `index` holds the link before it, as text: the def itself when it is
 * the `ref` to that link, and each `ref` to it below the def otherwise.
 */
export function holdingTextsOf(declared: ServiceSnapshot, index: number): string[] {
  const def = declared.defs[`link${index}`];
  const before = `link${index - 1}`;
  if (def === undefined) {
    return [];
  }
  const paths = isRefTo(def, before) ? [[stepText(def)]] : pathsIn(def, before, []);
  return paths.map((path) => path.join(' > '));
}
