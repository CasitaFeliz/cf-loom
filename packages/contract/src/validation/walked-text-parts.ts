import type { Endpoint, Guard, ServiceContract } from '../declarations/index.ts';
import { isEndpoint, isGuard } from '../declarations/index.ts';
import { type ObjectNode, walkSchemas } from '../walker/index.ts';
import { declarationsOf, type ObjectPart, type TextPartNodes } from '../written/index.ts';
import type { Failure } from './failures.ts';
import { paramsFailures } from './paths.ts';
import {
  locatedSchemasOf,
  type Nodes,
  nodesOf,
  refusalsAt,
  schemaSlotsAmong,
  textSlotsOf,
} from './schemas.ts';
import { notAllowedFailuresOf } from './shared-failures.ts';
import { conflictFailures, textPartFailures } from './text-only.ts';

/**
 * The text parts of a Contract walked, or every rule of `generate` they break, so the runtime reads
 * and writes text by what `generate` accepted. Its nodes are the Endpoints' and Guards', since a
 * Rejection's headers are judged and never read.
 */
export type WalkedTextParts =
  | { readonly kind: 'valid'; readonly nodes: ReadonlyMap<Endpoint | Guard, TextPartNodes> }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

/**
 * Walks the text parts of every Endpoint, Guard and Rejection of a Contract once, and judges them
 * by every rule `generate` applies to text parts: what they hold, their names, the path's params,
 * an enum whose values travel as one text and one shape per header or query name.
 */
export function walkedTextPartsOf(contract: ServiceContract): WalkedTextParts {
  const declarations = declarationsOf(contract, {});
  const { slots, failures: notSchemas } = schemaSlotsAmong(textSlotsOf(declarations));
  const walked = walkSchemas(locatedSchemasOf(slots), () => undefined);
  const nodes = nodesOf(slots, walked);
  const [first, ...others] = [
    ...notSchemas,
    ...notAllowedFailuresOf(refusalsAt(walked.located), walked.memoOf),
    ...textPartFailures(nodes),
    ...declarations.endpoints.flatMap((endpoint) => paramsFailures(endpoint, nodes)),
    ...declarations.endpoints.flatMap((endpoint) => conflictFailures(endpoint, nodes)),
  ];
  if (first !== undefined) {
    return { kind: 'invalid', failures: [first, ...others] };
  }
  return { kind: 'valid', nodes: nodesByDeclarationOf(nodes) };
}

function nodesByDeclarationOf(nodes: Nodes): ReadonlyMap<Endpoint | Guard, TextPartNodes> {
  const byDeclaration = new Map<Endpoint | Guard, Partial<Record<ObjectPart, ObjectNode>>>();
  for (const { owner, part, node } of nodes.slots) {
    if (!isDeclared(owner) || node.type !== 'object') {
      continue;
    }
    byDeclaration.set(owner, { ...byDeclaration.get(owner), [part]: node });
  }
  return byDeclaration;
}

function isDeclared(owner: unknown): owner is Endpoint | Guard {
  return isEndpoint(owner) || isGuard(owner);
}
