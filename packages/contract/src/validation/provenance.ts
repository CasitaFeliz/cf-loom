import type * as core from 'zod/v4/core';
import type { Origin, OriginOf, Path } from '../walker/index.ts';
import type { Declarations } from '../written/index.ts';
import { exportNamesOf } from './export-names.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { ImportedDefinitions, PackageIdentity, Unidentified } from './validate.ts';

/** An imported package with the imported packages of its kind that its files import, directly or through any package. */
export type Reaching<Package> = PackageIdentity & { readonly reaches: readonly Package[] };

/**
 * Which installed package a declaration belongs to: the one exporting it that reaches none of the
 * others exporting it, however its package.json names it, or none, or two with no one origin.
 */
export type Provenance<Package extends Reaching<Package> = ImportedDefinitions> =
  | { readonly kind: 'origin'; readonly package: Package }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly packages: readonly [Package, Package] };

/** The Definitions Package `value` belongs to among those imported, by identity over each package's exports. */
export function definitionsPackageOf(
  packages: readonly ImportedDefinitions[],
  value: unknown,
): Provenance {
  return originAmong(packages.filter(({ exports }) => Object.values(exports).includes(value)));
}

/** The one package among those exporting a declaration that imports it from none of the others, however many export it. */
export function originAmong<Package extends Reaching<Package>>(
  exporting: readonly Package[],
): Provenance<Package> {
  if (exporting.length === 0) {
    return { kind: 'none' };
  }
  const origins = exporting.filter((imported) => !reachesAnother(imported, exporting));
  const [origin] = origins;
  if (origin !== undefined && origins.length === 1) {
    return { kind: 'origin', package: origin };
  }
  const [one, two] = origins.length > 1 ? origins : exporting;
  if (one === undefined || two === undefined) {
    throw new Error('Two exporters, neither found the origin: a bug.');
  }
  return { kind: 'ambiguous', packages: [one, two] };
}

function reachesAnother<Package extends Reaching<Package>>(
  imported: Package,
  exporting: readonly Package[],
): boolean {
  return exporting.some((other) => other !== imported && imported.reaches.includes(other));
}

/** A package at a version, as an origin names it. */
export type OriginPackage = { readonly packageName: string; readonly version: string };

/** An installed package as an origin names it: `<package>@<version>`. */
export function originTextOf({ packageName, version }: OriginPackage): Origin {
  return `${packageName}@${version}`;
}

/** The package an origin names, without the `#<name>` of a shared schema: `originTextOf` read back; none for `local` and `standard`. */
export function originPackageOf(origin: string | undefined): OriginPackage | undefined {
  const named = (origin ?? '').split('#', 1)[0] ?? '';
  const at = named.lastIndexOf('@');
  if (at <= 0) {
    return undefined;
  }
  return { packageName: named.slice(0, at), version: named.slice(at + 1) };
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
    if (provenance.kind !== 'origin' || provenance.package.kind !== 'identified') {
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
    case 'none':
      return undefined;
    case 'ambiguous':
      return ambiguousFailureAt(at, provenance.packages);
    case 'origin':
      return identityFailureAt(at, provenance.package);
  }
}

/** The failure of an origin package whose package.json lacks a name or a version; none when it has both. */
function identityFailureAt(at: Path, origin: ImportedDefinitions): DeclarationFailure | undefined {
  switch (origin.kind) {
    case 'identified':
      return undefined;
    case 'unnamed':
    case 'unversioned':
      return unidentifiedFailureAt(at, origin);
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
