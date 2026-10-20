import { isApplication, isContract, isDefinitions } from '../declarations/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import {
  keyedRecordsOf,
  type OriginOf,
  openIntersectionsOf,
  walkSchemas,
} from '../walker/index.ts';
import { type Declarations, declarationsOf, isReadShapePart, type Root } from '../written/index.ts';
import { type ExportsOf, unlistedFailures } from './definitions.ts';
import { dependencyFailures } from './dependencies.ts';
import { endpointFailures } from './endpoints.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { fieldFailures } from './fields.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import { nameFailures } from './name-grammars.ts';
import { groupFailures, packageNameFailures, uniquenessFailures } from './names.ts';
import { paramsFailures, pathFailures } from './paths.ts';
import { rejectionBodyFailures, rejectionFailures } from './rejections.ts';
import {
  failuresAt,
  locatedSchemasOf,
  type NodeLookup,
  type Nodes,
  nodeLookupOf,
  nodesOf,
  schemaSlotsOf,
} from './schemas.ts';
import { structureFailures } from './structure.ts';
import { conflictFailures, textPartFailures } from './text-only.ts';
import { type ValidatedDeclarations, validatedDeclarationsOf } from './validated.ts';

/**
 * The walked schemas of a valid root and their `defs`: `nodeOf` finds the node of a declaration's
 * part, a shared schema being its own declaration.
 */
export type ValidatedSchemas = {
  readonly nodeOf: NodeLookup;
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/**
 * The package a root sits in: the unscoped name of its package.json, which the root is named as,
 * and what the Definitions Packages installed beside it tell: where each schema came from and
 * what each package's module exports.
 */
export type RootPackage = {
  readonly packageName: string;
  readonly originOf: OriginOf;
  readonly exportsOf: ExportsOf;
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

/** A root the validation found valid: the only input a Snapshot is built from. */
export type ValidContract = Extract<ValidatedContract, { readonly kind: 'valid' }>;

/**
 * Checks every rule `generate` enforces on a root's declarations and walks every schema of it
 * once, reporting all failures together, since a cast or a widened type skips the rules the
 * types state; what a module exports as its root is judged whatever it is.
 */
export function validateContract(root: unknown, rootPackage: RootPackage): ValidatedContract {
  if (!isRoot(root)) {
    const message = 'A root is a Contract, an Application or a Definitions Package';
    return invalid([failure([], 'not-a-root', message)]);
  }
  const declarations = declarationsOf(root);
  const slots = schemaSlotsOf(declarations);
  const walked = walkSchemas(locatedSchemasOf(slots.slots), rootPackage.originOf);
  const nodes = nodesOf(slots.slots, walked);
  const failures = [
    ...declarationFailures(declarations),
    ...packageNameFailures(root, rootPackage.packageName),
    ...unlistedFailures(declarations, rootPackage.exportsOf),
    ...slots.failures,
    ...schemaFailures(declarations, nodes),
    ...textPartFailures(nodes),
    ...openIntersectionsOf(nodes.slots, nodes.defs),
    ...keyedRecordsOf({ queryOrHeaders: [], readShapes: readShapeSlotsOf(nodes) }, nodes.defs),
    ...new Set(walked.located.flatMap(failuresAt)),
  ];
  if (failures.length > 0) {
    return invalid(failures);
  }
  return {
    kind: 'valid',
    schemas: {
      nodeOf: nodeLookupOf(nodes),
      defs: nodes.defs,
    },
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

/** The slots of Read shapes' bodies, where a record keyed by an enum or literal is refused at any depth. */
function readShapeSlotsOf(nodes: Nodes): Nodes['slots'] {
  return nodes.slots.filter((slot) => isReadShapePart(slot.part));
}
