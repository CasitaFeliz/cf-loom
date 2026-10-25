import {
  type Definitions,
  isApplication,
  isContract,
  isDefinitions,
} from '../declarations/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import { type OriginOf, openCompositionsOf, walkSchemas } from '../walker/index.ts';
import { type Declarations, declarationsOf, type ExportsOf, type Root } from '../written/index.ts';
import { exportFailures } from './definitions.ts';
import { dependencyFailures } from './dependencies.ts';
import { endpointFailures } from './endpoints.ts';
import { type DeclarationFailure, type Failure, failure } from './failures.ts';
import { fieldFailures } from './fields.ts';
import { groupFailures } from './groups.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import { messageBodyFailures, messageFailures } from './messages.ts';
import { nameFailures } from './name-grammars.ts';
import { listedOnceFailures, packageNameFailures, uniquenessFailures } from './names.ts';
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
import { onceFailures } from './standard-codes.ts';
import { structureFailures } from './structure.ts';
import { subscriptionFailures } from './subscriptions.ts';
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
 * A Definitions Package installed where the root is validated: its Definitions object, the
 * package.json name and exact version, which the Snapshot records, and what its module exports,
 * by name.
 */
export type ResolvedDefinitions = {
  readonly definitions: Definitions;
  readonly packageName: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
};

/**
 * The package a root sits in: its package.json name, scope included, which a Service's or
 * Application's root is named as without the scope; every Definitions Package its files import,
 * as Node resolved them; where each shared schema came from; and what each package's module exports.
 */
export type RootPackage = {
  readonly packageName: string;
  readonly packages: readonly ResolvedDefinitions[];
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
  const declarations = declarationsOf(root, rootPackage.exportsOf);
  const slots = schemaSlotsOf(declarations);
  const walked = walkSchemas(locatedSchemasOf(slots.slots), rootPackage.originOf);
  const nodes = nodesOf(slots.slots, walked);
  const failures = [
    ...declarationFailures(declarations),
    ...packageNameFailures(root, rootPackage.packageName),
    ...listedOnceFailures(declarations, rootPackage.packages),
    ...onceFailures(declarations, rootPackage.packages),
    ...exportFailures(declarations, rootPackage.exportsOf),
    ...slots.failures,
    ...schemaFailures(declarations, nodes),
    ...textPartFailures(nodes),
    ...openCompositionsOf(nodes.slots, nodes.defs),
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
    declarations: validatedDeclarationsOf(declarations, rootPackage),
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
    ...messageFailures(declarations),
    ...subscriptionFailures(declarations),
  ];
}

/** The rules that read the walked nodes, judged on every schema that walked. */
function schemaFailures(declarations: Declarations, nodes: Nodes): readonly DeclarationFailure[] {
  return [
    ...declarations.endpoints.flatMap((endpoint) => paramsFailures(endpoint, nodes)),
    ...declarations.endpoints.flatMap((endpoint) => qualifierFailures(endpoint, nodes)),
    ...rejectionBodyFailures(declarations, nodes),
    ...messageBodyFailures(declarations, nodes),
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
