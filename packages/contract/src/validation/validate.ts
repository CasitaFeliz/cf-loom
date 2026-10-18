import type { SchemaNode } from '../walker/nodes.ts';
import { type OriginOf, walkSchemas } from '../walker/walk.ts';
import { type Declarations, declarationsOf, type Root } from './declarations.ts';
import type { DeclarationFailure, Failure } from './failures.ts';
import { pathFailures } from './paths.ts';
import { type LocatedNode, type Nodes, nodesOf, schemaSlotsOf } from './schemas.ts';

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
  if (walked.kind === 'not-allowed') {
    return invalid([...declared, ...walked.failures]);
  }
  const nodes = slots.located.map(({ at }, index) => ({ at, node: nodeAt(walked.nodes, index) }));
  const failures = [...declared, ...schemaFailures(declarations, nodesOf(nodes, walked.defs))];
  if (failures.length > 0) {
    return invalid(failures);
  }
  return { kind: 'valid', schemas: { nodes, defs: walked.defs } };
}

/** The rules that read declarations alone, so they are judged even when a schema fails the walk. */
function declarationFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [...declarations.endpoints.flatMap(pathFailures)];
}

/** The rules that read the walked nodes, judged once every schema walked. */
function schemaFailures(_declarations: Declarations, _nodes: Nodes): readonly DeclarationFailure[] {
  return [];
}

function invalid(failures: readonly Failure[]): ValidatedContract {
  const [first, ...others] = failures;
  if (first === undefined) {
    throw new Error('An invalid root must name at least one failure.');
  }
  return { kind: 'invalid', failures: [first, ...others] };
}

/** The walk returns one node per schema given, in order; fewer is a bug of the walker. */
function nodeAt(nodes: readonly SchemaNode[], index: number): SchemaNode {
  const node = nodes[index];
  if (node === undefined) {
    throw new Error('The walk returned fewer nodes than schemas: a bug.');
  }
  return node;
}
