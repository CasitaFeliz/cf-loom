import type { Endpoint, Guard, ServiceContract } from '../declarations/index.ts';
import { isEndpoint, isGuard } from '../declarations/index.ts';
import { type ObjectNode, walkSchemas } from '../walker/index.ts';
import { declarationsOf, type ObjectPart } from '../written/index.ts';
import type { Failure } from './failures.ts';
import { paramsFailures } from './paths.ts';
import {
  failuresAt,
  locatedSchemasOf,
  type Nodes,
  nodesOf,
  schemaSlotsAmong,
  textSlotsOf,
} from './schemas.ts';
import { conflictFailures, textPartFailures } from './text-only.ts';

/** The walked parts of one Endpoint or Guard that travel as text, each an object of its fields. */
export type TextPartNodes = Readonly<Partial<Record<ObjectPart, ObjectNode>>>;

/**
 * The text parts of a Contract's Endpoints and Guards walked, by declaration, or every rule of
 * `generate` they and its Rejections' headers break, so the runtime reads text by the nodes
 * `generate` accepted.
 */
export type WalkedTextParts =
  | { readonly kind: 'valid'; readonly nodes: ReadonlyMap<Endpoint | Guard, TextPartNodes> }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

/**
 * Walks the text parts of every Endpoint, Guard and Rejection of a Contract once, and judges them
 * by every rule `generate` applies to text parts: what they hold, their names, the path's params
 * and one shape per header or query name.
 */
export function walkedTextPartsOf(contract: ServiceContract): WalkedTextParts {
  const declarations = declarationsOf(contract, {});
  const { slots, failures: notSchemas } = schemaSlotsAmong(textSlotsOf(declarations));
  const walked = walkSchemas(locatedSchemasOf(slots), () => undefined);
  const nodes = nodesOf(slots, walked);
  const [first, ...others] = [
    ...notSchemas,
    ...walked.located.flatMap(failuresAt),
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
