import type { Definitions, Root } from '../declarations/index.ts';
import { openCompositionsOf, type SchemaNode, walkMeetingSchemas } from '../walker/index.ts';
import { type Declarations, declarationsOf } from '../written/index.ts';
import { codeOnceFailures } from './code-once.ts';
import { exportFailures } from './definitions.ts';
import { dependencyFailures } from './dependencies.ts';
import { dependencyPackageFailures } from './dependency-packages.ts';
import { endpointFailures } from './endpoints.ts';
import type { DeclarationFailure, Failure } from './failures.ts';
import { fieldFailures } from './fields.ts';
import { groupFailures } from './groups.ts';
import { attachmentFailures, guardFailures, qualifierFailures } from './guards.ts';
import { messageBodyFailures, messageFailures } from './messages.ts';
import { nameFailures } from './name-grammars.ts';
import { packageNameFailures, uniquenessFailures } from './names.ts';
import { paramsFailures, pathFailures } from './paths.ts';
import { provenanceFailures, schemaOriginsOf } from './provenance.ts';
import { rejectionFailures } from './rejections.ts';
import {
  locatedSchemasOf,
  type NodeLookup,
  type Nodes,
  nodeLookupOf,
  nodesOf,
  refusalsAt,
  schemaSlotsOf,
} from './schemas.ts';
import { notAllowedFailuresOf } from './shared-failures.ts';
import { structureFailures } from './structure.ts';
import { subscriptionFailures } from './subscriptions.ts';
import { conflictFailures, textPartFailures } from './text-only.ts';
import { type ValidatedDeclarations, validatedDeclarationsOf } from './validated.ts';

/**
 * The walked schemas of a valid Root and their `defs`: `nodeOf` finds the node of a declaration's
 * part, a shared schema being its own declaration.
 */
export type ValidatedSchemas = {
  readonly nodeOf: NodeLookup;
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/**
 * An installed package whose package.json does not name it, so no origin can: which of the name
 * and the version it lacks, with the path of a nameless package.json as lines name it.
 */
export type Unidentified =
  | { readonly kind: 'unnamed'; readonly manifest: string }
  | { readonly kind: 'unversioned'; readonly packageName: string };

/** Who an installed package is, from its package.json: the name and exact version an origin names it by, or what it lacks. */
export type PackageIdentity =
  | { readonly kind: 'identified'; readonly packageName: string; readonly version: string }
  | Unidentified;

/**
 * A Definitions Package the Root's files import, as Node resolved it: who its package.json says it
 * is, its Definitions object, what its module exports by name, and the other imported Definitions
 * Packages its files import, directly or through any package, which says which of two exporters of
 * one object imports it from the other.
 */
export type ImportedDefinitions = PackageIdentity & {
  readonly definitions: Definitions;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly reaches: readonly ImportedDefinitions[];
};

/** An imported Definitions Package whose package.json names it, the only kind an origin can name. */
export type ResolvedDefinitions = Extract<ImportedDefinitions, { readonly kind: 'identified' }>;

/**
 * A Contract Package the Root's files import, as Node resolved it: who its package.json says it
 * is, the Provided Elements its modules export, and the other imported Contract Packages its files
 * import, directly or through any package, which says which of two exporters of one Element
 * imports it from the other.
 */
export type ImportedContractPackage = PackageIdentity & {
  readonly elements: readonly unknown[];
  readonly reaches: readonly ImportedContractPackage[];
};

/** An imported Contract Package whose package.json names it, the only kind the Snapshot can record as a Provider's `against`. */
export type ResolvedContractPackage = Extract<
  ImportedContractPackage,
  { readonly kind: 'identified' }
>;

/**
 * The package a Root sits in: its package.json name, scope included; every Definitions Package and
 * every Contract Package its files import, as Node resolved them, named by their package.json or
 * not; and what the Root file exports beside the Root, by name, which a Definitions Package's
 * members are.
 */
export type RootPackage = {
  readonly packageName: string;
  readonly packages: readonly ImportedDefinitions[];
  readonly contractPackages: readonly ImportedContractPackage[];
  readonly rootExports: Readonly<Record<string, unknown>>;
};

/**
 * A Root validated: its schemas walked and its declarations gathered for the Snapshot, or every
 * failure in it, declarations and schemas alike.
 */
export type ValidatedRoot =
  | {
      readonly kind: 'valid';
      readonly schemas: ValidatedSchemas;
      readonly declarations: ValidatedDeclarations;
    }
  | { readonly kind: 'invalid'; readonly failures: readonly [Failure, ...Failure[]] };

/** A Root the validation found valid: the only input a Snapshot is built from. */
export type ValidRoot = Extract<ValidatedRoot, { readonly kind: 'valid' }>;

/**
 * Checks every rule `generate` enforces on a Root's declarations and walks every schema of it
 * once, reporting all failures together, since a cast or a widened type skips the rules the
 * types state.
 */
export function validateRoot(root: Root, rootPackage: RootPackage): ValidatedRoot {
  const { packages, contractPackages, rootExports } = rootPackage;
  const declarations = declarationsOf(root, rootExports);
  const slots = schemaSlotsOf(declarations);
  const walked = walkMeetingSchemas(locatedSchemasOf(slots.slots), schemaOriginsOf(packages));
  const nodes = nodesOf(slots.slots, walked);
  const opened = openCompositionsOf(walked.compositions, walked.defs);
  const refusals = [...opened, ...refusalsAt(walked.located)];
  const failures = [
    ...declarationFailures(declarations),
    ...packageNameFailures(root, rootPackage.packageName),
    ...exportFailures(declarations, rootExports),
    ...provenanceFailures(declarations, packages, walked.met),
    ...dependencyPackageFailures(declarations, contractPackages),
    ...codeOnceFailures(declarations, packages),
    ...slots.failures,
    ...schemaFailures(declarations, nodes),
    ...textPartFailures(nodes),
    ...notAllowedFailuresOf(refusals, walked.memoOf),
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
    ...messageBodyFailures(declarations, nodes),
    ...declarations.endpoints.flatMap((endpoint) => conflictFailures(endpoint, nodes)),
  ];
}

function invalid(failures: readonly Failure[]): ValidatedRoot {
  const [first, ...others] = failures;
  if (first === undefined) {
    throw new Error('An invalid Root must name at least one failure.');
  }
  return { kind: 'invalid', failures: [first, ...others] };
}
