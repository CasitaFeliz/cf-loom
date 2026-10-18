import { isApplication, isContract, isDefinitions } from '../declarations/index.ts';
import type { NotAllowed, SchemaNode } from '../walker/index.ts';
import { type OriginOf, type WalkedLocation, walkSchemas } from '../walker/index.ts';
import { type Declarations, declarationsOf } from './declarations.ts';
import { dependencyFailures } from './dependencies.ts';
import { endpointFailures } from './endpoints.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { fieldFailures } from './fields.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import type { Root } from './located.ts';
import { groupFailures, nameFailures, uniquenessFailures } from './names.ts';
import { paramsFailures, pathFailures } from './paths.ts';
import { rejectionBodyFailures, rejectionFailures } from './rejections.ts';
import {
  type LocatedNode,
  locatedSchemasOf,
  type Nodes,
  nodesOf,
  schemaSlotsOf,
} from './schemas.ts';
import { structureFailures } from './structure.ts';
import { conflictFailures, textFailures } from './text-only.ts';
import { type ValidatedDeclarations, validatedDeclarationsOf } from './validated.ts';

/** The walked schemas of a valid root, each where its declaration sits, and their `defs`. */
export type ValidatedSchemas = {
  readonly nodes: readonly LocatedNode[];
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/**
 * A root validated: its schemas walked and its declarations gathered for the Snapshot, or every
 * failure in it, declarations and schemas alike.
 */
export type ValidatedContract =
  | {
      readonly kind: 'valid';
      readonly schemas: ValidatedSchemas;
      readonly declarations: ValidatedDeclarations;
    }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

/**
 * Checks every rule `generate` enforces on a root's declarations and walks every schema of it
 * once, reporting all failures together, since a cast or a widened type skips the rules the
 * types state; what a module exports as its root is judged whatever it is.
 */
export function validateContract(root: unknown, originOf: OriginOf): ValidatedContract {
  if (!isRoot(root)) {
    const message = 'A root is a Contract, an Application or a Definitions Package';
    return invalid([failure([], 'not-a-root', message)]);
  }
  const declarations = declarationsOf(root);
  const slots = schemaSlotsOf(declarations);
  const walked = walkSchemas(locatedSchemasOf(slots.slots), originOf);
  const nodes = nodesOf(slots.slots, walked);
  const failures = [
    ...declarationFailures(declarations),
    ...slots.failures,
    ...schemaFailures(declarations, nodes),
    ...new Set(walked.located.flatMap(failuresAt)),
  ];
  if (failures.length > 0) {
    return invalid(failures);
  }
  const written = nodes.slots.filter((slot) => slot.role === 'snapshot');
  return {
    kind: 'valid',
    schemas: { nodes: written.map(({ at, node }) => ({ at, node })), defs: nodes.defs },
    declarations: validatedDeclarationsOf(declarations),
  };
}

/** The rules that read declarations alone, so they are judged even when a schema fails the walk. */
function declarationFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [
    ...structureFailures(declarations),
    ...fieldFailures(declarations),
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

/** The rules that read the walked nodes, judged on every schema that walked. */
function schemaFailures(declarations: Declarations, nodes: Nodes): readonly DeclarationFailure[] {
  return [
    ...declarations.endpoints.flatMap((endpoint) => paramsFailures(endpoint, nodes)),
    ...declarations.endpoints.flatMap((endpoint) => qualifierFailures(endpoint, nodes)),
    ...rejectionBodyFailures(declarations, nodes),
    ...textFailures(nodes),
    ...declarations.endpoints.flatMap((endpoint) => conflictFailures(endpoint, nodes)),
  ];
}

function isRoot(value: unknown): value is Root {
  return isContract(value) || isApplication(value) || isDefinitions(value);
}

function invalid(failures: readonly Failure[]): ValidatedContract {
  const [first, ...others] = failures;
  if (first === undefined) {
    throw new Error('An invalid root must name at least one failure.');
  }
  return { kind: 'invalid', failures: [first, ...others] };
}

/** A cycle's failure comes back wherever the cycle is met, so the same failure may repeat. */
function failuresAt(location: WalkedLocation): readonly NotAllowed[] {
  return location.walked.kind === 'not-allowed' ? location.walked.failures : [];
}
