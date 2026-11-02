import type {
  CommandSnapshot,
  EndpointSnapshot,
  EventSnapshot,
  MessageTombstone,
} from '../snapshot/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import { isSameReaching } from './def-comparison.ts';
import type { BothDefs } from './findings.ts';
import { type Pair, retiredShapesOf } from './pairs.ts';
import type { Difference } from './report.ts';

/** What an Element Retired in the proposed Snapshot may still declare. */
type Declaration = EndpointSnapshot | EventSnapshot | CommandSnapshot;

/**
 * Whether an Element Retired in the proposed Snapshot declares anything the Baseline's declaration
 * did not, the defs it reaches included; nothing reads it, so no other rule compares it.
 */
export function retiredDifferencesOf(
  pair: Pair<Declaration>,
  defs: BothDefs,
): readonly Difference[] {
  const compared = retiredShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const declared = {
    baseline: declaredOf(compared.baseline),
    proposed: declaredOf(compared.proposed),
  };
  return isSameReaching(declared, nodesOf(compared.baseline), defs)
    ? []
    : [{ kind: 'retired-changed' }];
}

/** What moves with an Element's lifecycle, which the lifecycle's own Change already reports. */
const historyKeys = ['lifecycle', 'retiredIn', 'deprecatedAt'] as const satisfies readonly (
  | keyof EndpointSnapshot
  | keyof MessageTombstone
)[];

/** A declaration without the history the Baseline keeps of it. */
function declaredOf(declaration: Declaration): unknown {
  const declared = Object.entries(declaration).filter(
    ([key]) => !historyKeys.some((history) => history === key),
  );
  return Object.fromEntries(declared);
}

function nodesOf(declaration: Declaration): readonly SchemaNode[] {
  if (!('input' in declaration)) {
    return [declaration.body];
  }
  const { input, success } = declaration;
  const nodes = [
    input.params,
    input.query,
    input.headers,
    input.body,
    success.headers,
    success.body,
  ];
  return nodes.filter(isNode);
}

function isNode(node: SchemaNode | null): node is SchemaNode {
  return node !== null;
}
