import { isApplication, isContract, isDefinitions } from '../declarations/index.ts';
import type { NotAllowed, ObjectNode, SchemaNode } from '../walker/index.ts';
import {
  type OriginOf,
  openIntersectionsOf,
  type WalkedLocation,
  walkSchemas,
} from '../walker/index.ts';
import { type Declarations, declarationsOf } from './declarations.ts';
import { type ExportsOf, unlistedFailures } from './definitions.ts';
import { dependencyFailures } from './dependencies.ts';
import { endpointFailures } from './endpoints.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { fieldFailures } from './fields.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import type { Root } from './located.ts';
import { groupFailures, nameFailures, packageNameFailures, uniquenessFailures } from './names.ts';
import { type ObjectPart, objectParts, type Part } from './parts.ts';
import { paramsFailures, pathFailures } from './paths.ts';
import { rejectionBodyFailures, rejectionFailures } from './rejections.ts';
import { locatedSchemasOf, type Nodes, nodesOf, schemaSlotsOf } from './schemas.ts';
import { structureFailures } from './structure.ts';
import { conflictFailures, textFailures } from './text-only.ts';
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
 * The node of a declaration's part, if it declares that part: an object for a part that travels as
 * text, since the validation refuses any other there.
 */
export type NodeLookup = {
  (declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  (declaration: unknown, part: Part): SchemaNode | undefined;
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
    ...nodes.slots.flatMap(({ at, node }) => openIntersectionsOf(node, at, nodes.defs)),
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

/** Finds a valid root's nodes by declaration and part, a text part's typed as the object it is. */
function nodeLookupOf(nodes: Nodes): NodeLookup {
  function nodeOf(declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined {
    const node = nodes.nodeOf(declaration, part);
    return isObjectPart(part) && node?.type !== 'object' ? undefined : node;
  }
  return nodeOf;
}

function isObjectPart(part: Part): part is ObjectPart {
  const parts: readonly Part[] = objectParts;
  return parts.includes(part);
}
