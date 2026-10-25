import type * as core from 'zod/v4/core';
import type { Origin, OriginOf, Path } from '../walker/index.ts';
import type { Declarations } from '../written/index.ts';
import { exportNamesOf } from './export-names.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type {
  ImportedDefinitions,
  PackageIdentity,
  ResolvedDefinitions,
  Unidentified,
} from './validate.ts';

/**
 * Which Definitions Package a value belongs to: the one exporting it that reaches none of the
 * others exporting it, found when its package.json names it, unidentified when it does not.
 */
export type Provenance =
  | { readonly kind: 'found'; readonly package: ResolvedDefinitions }
  | {
      readonly kind: 'unidentified';
      readonly package: Exclude<ImportedDefinitions, ResolvedDefinitions>;
    }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ambiguous';
      readonly packages: readonly [ImportedDefinitions, ImportedDefinitions];
    };

/** The Definitions Package `value` belongs to among those imported, by identity over each package's exports. */
export function definitionsPackageOf(
  packages: readonly ImportedDefinitions[],
  value: unknown,
): Provenance {
  const exporting = packages.filter(({ exports }) => Object.values(exports).includes(value));
  if (exporting.length === 0) {
    return { kind: 'none' };
  }
  const origins = exporting.filter((imported) => !reachesAnother(imported, exporting));
  const [origin] = origins;
  if (origin !== undefined && origins.length === 1) {
    return originOf(origin);
  }
  const [one, two] = origins.length > 1 ? origins : exporting;
  if (one === undefined || two === undefined) {
    throw new Error('Two exporters, neither found the origin: a bug.');
  }
  return { kind: 'ambiguous', packages: [one, two] };
}

/** The one package a value belongs to, as its package.json lets an origin name it or not. */
function originOf(origin: ImportedDefinitions): Provenance {
  switch (origin.kind) {
    case 'identified':
      return { kind: 'found', package: origin };
    case 'unnamed':
    case 'unversioned':
      return { kind: 'unidentified', package: origin };
  }
}

function reachesAnother(
  imported: ImportedDefinitions,
  exporting: readonly ImportedDefinitions[],
): boolean {
  return exporting.some((other) => other !== imported && imported.reaches.includes(other));
}

/** An installed package as an origin names it: `<package>@<version>`. */
export function originTextOf({ packageName, version }: ResolvedDefinitions): Origin {
  return `${packageName}@${version}`;
}

/** A package as a line names it: its package.json name, or the package.json's path when it has none. */
export function packageLabelOf(identity: PackageIdentity): string {
  switch (identity.kind) {
    case 'identified':
    case 'unversioned':
      return identity.packageName;
    case 'unnamed':
      return identity.manifest;
  }
}

/** The line saying a package has no version, the one way any command says it. */
export function noVersionLineOf(packageName: string): string {
  return `${packageName} has no version in its package.json`;
}

/** The one line saying what a package.json lacks to name its package. */
export function identityLineOf(identity: Unidentified): string {
  switch (identity.kind) {
    case 'unnamed':
      return `${identity.manifest} has no name`;
    case 'unversioned':
      return noVersionLineOf(identity.packageName);
  }
}

/**
 * Where each shared schema came from, as the walk writes it on the node: the package it belongs
 * to and the first name, in code point order, that package exports it under; a clone of one is a
 * new schema and has none.
 */
export function schemaOriginsOf(packages: readonly ImportedDefinitions[]): OriginOf {
  return (schema) => {
    const provenance = definitionsPackageOf(packages, schema);
    if (provenance.kind !== 'found') {
      return undefined;
    }
    const [name] = exportNamesOf(provenance.package.exports, schema);
    return `${originTextOf(provenance.package)}#${name ?? ''}`;
  };
}

/**
 * Each reached Guard, code and met schema that no one Definitions Package can be named for: two
 * export it and neither imports it from the other, or the one it belongs to has no name or version.
 */
export function provenanceFailures(
  { guards, codes }: Declarations,
  packages: readonly ImportedDefinitions[],
  met: ReadonlyMap<core.$ZodType, Path>,
): readonly DeclarationFailure[] {
  const declared: { readonly at: Path; readonly declaration: unknown }[] = [
    ...guards.map(({ at, guard }) => ({ at, declaration: guard })),
    ...codes.map(({ at, rejections: [first] }) => ({ at, declaration: first.rejection })),
    ...[...met].map(([schema, at]) => ({ at, declaration: schema })),
  ];
  return declared
    .map(({ at, declaration }) => failureAt(at, definitionsPackageOf(packages, declaration)))
    .filter(isFailure);
}

/** The failure a declaration's provenance is, when no one Definitions Package can be named for it. */
function failureAt(at: Path, provenance: Provenance): DeclarationFailure | undefined {
  switch (provenance.kind) {
    case 'found':
    case 'none':
      return undefined;
    case 'ambiguous':
      return ambiguousFailureAt(at, provenance.packages);
    case 'unidentified':
      return unidentifiedFailureAt(at, provenance.package);
  }
}

function isFailure(found: DeclarationFailure | undefined): found is DeclarationFailure {
  return found !== undefined;
}

function ambiguousFailureAt(
  at: Path,
  [first, second]: readonly [ImportedDefinitions, ImportedDefinitions],
): DeclarationFailure {
  const both = `exported by both ${packageLabelOf(first)} and ${packageLabelOf(second)}`;
  const message = `A declaration belongs to one Definitions Package: ${both}, and neither imports it from the other`;
  return failure(at, 'definitions-ambiguous', message);
}

function unidentifiedFailureAt(at: Path, identity: Unidentified): DeclarationFailure {
  const message = `A Definitions Package a declaration comes from has a name and a version: ${identityLineOf(identity)}`;
  return failure(at, 'definitions-unidentified', message);
}
