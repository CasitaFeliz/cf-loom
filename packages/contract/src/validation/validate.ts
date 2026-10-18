import type { NotAllowed, SchemaNode } from '../walker/nodes.ts';
import { type OriginOf, type WalkedLocation, walkSchemas } from '../walker/walk.ts';
import { type Declarations, declarationsOf, type Root } from './declarations.ts';
import { dependencyFailures } from './dependencies.ts';
import { endpointFailures } from './endpoints.ts';
import type { DeclarationFailure, Failure } from './failures.ts';
import { undeclaredFieldFailures } from './fields.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import { groupFailures, nameFailures, uniquenessFailures } from './names.ts';
import { paramsFailures, pathFailures } from './paths.ts';
import { rejectionBodyFailures, rejectionFailures } from './rejections.ts';
import { type LocatedNode, type Nodes, nodesOf, schemaSlotsOf } from './schemas.ts';
import { conflictFailures, textFailures } from './text-only.ts';

/** The walked schemas of a valid root, each where its declaration sits, and their `defs`. */
export type ValidatedSchemas = {
  readonly nodes: readonly LocatedNode[];
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/** A root validated: its schemas walked, or every failure in it, declarations and schemas alike. */
export type ValidatedContract =
  | { readonly kind: 'valid'; readonly schemas: ValidatedSchemas }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

/**
 * Checks every rule `generate` enforces on a root's declarations and walks every schema of it
 * once, reporting all failures together, since a cast or a widened type skips the rules the
 * types state.
 */
export function validateContract(root: Root, originOf: OriginOf): ValidatedContract {
  const declarations = declarationsOf(root);
  const slots = schemaSlotsOf(declarations);
  const declared = [...declarationFailures(declarations), ...slots.failures];
  const walked = walkSchemas(slots.located, originOf);
  const nodes = walked.located
    .filter(hasNode)
    .map(({ at, walked: node }) => ({ at, node: node.value }));
  const notAllowed = [...new Set(walked.located.flatMap(failuresAt))];
  const failures = [
    ...declared,
    ...schemaFailures(declarations, nodesOf(nodes, walked.defs)),
    ...notAllowed,
  ];
  if (failures.length > 0) {
    return invalid(failures);
  }
  return { kind: 'valid', schemas: { nodes, defs: walked.defs } };
}

/** The rules that read declarations alone, so they are judged even when a schema fails the walk. */
function declarationFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [
    ...undeclaredFieldFailures(declarations),
    ...nameFailures(declarations),
    ...uniquenessFailures(declarations),
    ...groupFailures(declarations),
    ...declarations.endpoints.flatMap(pathFailures),
    ...declarations.endpoints.flatMap(endpointFailures),
    ...declarations.guards.flatMap(guardFailures),
    ...declarations.endpoints.flatMap(attachmentFailures),
    ...rejectionFailures(declarations),
    ...dependencyFailures(declarations),
  ];
}

/** The rules that read the walked nodes, judged once every schema walked. */
function schemaFailures(declarations: Declarations, nodes: Nodes): readonly DeclarationFailure[] {
  return [
    ...declarations.endpoints.flatMap((endpoint) => paramsFailures(endpoint, nodes)),
    ...declarations.endpoints.flatMap((endpoint) => qualifierFailures(endpoint, nodes)),
    ...rejectionBodyFailures(declarations, nodes),
    ...textFailures(declarations, nodes),
    ...declarations.endpoints.flatMap((endpoint) => conflictFailures(endpoint, nodes)),
  ];
}

function invalid(failures: readonly Failure[]): ValidatedContract {
  const [first, ...others] = failures;
  if (first === undefined) {
    throw new Error('An invalid root must name at least one failure.');
  }
  return { kind: 'invalid', failures: [first, ...others] };
}

function hasNode(
  location: WalkedLocation,
): location is WalkedLocation & { readonly walked: { readonly kind: 'walked' } } {
  return location.walked.kind === 'walked';
}

/** A cycle's failure comes back wherever the cycle is met, so the same failure may repeat. */
function failuresAt(location: WalkedLocation): readonly NotAllowed[] {
  return location.walked.kind === 'not-allowed' ? location.walked.failures : [];
}
