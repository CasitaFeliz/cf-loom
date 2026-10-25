import type * as core from 'zod/v4/core';
import type { Origin, OriginOf, Path } from '../walker/index.ts';
import type { Declarations } from '../written/index.ts';
import { exportNamesOf } from './export-names.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { ResolvedDefinitions, RootPackage } from './validate.ts';

/** Which Definitions Package a value belongs to: the one exporting it that reaches none of the others exporting it. */
export type Provenance =
  | { readonly kind: 'found'; readonly package: ResolvedDefinitions }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ambiguous';
      readonly packages: readonly [ResolvedDefinitions, ResolvedDefinitions];
    };

/** The Definitions Package `value` belongs to among those installed, by identity over each package's exports. */
export function definitionsPackageOf(
  packages: readonly ResolvedDefinitions[],
  value: unknown,
): Provenance {
  const exporting = packages.filter(({ exports }) => Object.values(exports).includes(value));
  if (exporting.length === 0) {
    return { kind: 'none' };
  }
  const origins = exporting.filter((resolved) => !reachesAnother(resolved, exporting));
  const [origin] = origins;
  if (origin !== undefined && origins.length === 1) {
    return { kind: 'found', package: origin };
  }
  const [one, two] = origins.length > 1 ? origins : exporting;
  if (one === undefined || two === undefined) {
    throw new Error('Two exporters, neither found the origin: a bug.');
  }
  return { kind: 'ambiguous', packages: [one, two] };
}

function reachesAnother(
  resolved: ResolvedDefinitions,
  exporting: readonly ResolvedDefinitions[],
): boolean {
  return exporting.some((other) => other !== resolved && resolved.reaches.includes(other));
}

/** An installed package as an origin names it: `<package>@<version>`. */
export function originTextOf({ packageName, version }: ResolvedDefinitions): Origin {
  return `${packageName}@${version}`;
}

/**
 * Where each shared schema came from, as the walk writes it on the node: the package it belongs
 * to and the first name, in code point order, that package exports it under; a clone of one is a
 * new schema and has none.
 */
export function schemaOriginsOf(packages: readonly ResolvedDefinitions[]): OriginOf {
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
 * export it and neither imports it from the other, or the one exporting it has no name or version.
 */
export function provenanceFailures(
  { guards, codes }: Declarations,
  { packages, unidentified }: Pick<RootPackage, 'packages' | 'unidentified'>,
  met: ReadonlyMap<core.$ZodType, Path>,
): readonly DeclarationFailure[] {
  const declared: { readonly at: Path; readonly declaration: unknown }[] = [
    ...guards.map(({ at, guard }) => ({ at, declaration: guard })),
    ...codes.map(({ at, rejections: [first] }) => ({ at, declaration: first.rejection })),
    ...[...met].map(([schema, at]) => ({ at, declaration: schema })),
  ];
  return declared.flatMap(({ at, declaration }) => {
    const provenance = definitionsPackageOf(packages, declaration);
    if (provenance.kind === 'ambiguous') {
      return [ambiguousFailureAt(at, provenance.packages)];
    }
    const exporter = provenance.kind === 'none' ? exporterIn(unidentified, declaration) : undefined;
    return exporter === undefined ? [] : [unidentifiedFailureAt(at, exporter.why)];
  });
}

function exporterIn(
  unidentified: RootPackage['unidentified'],
  declaration: unknown,
): RootPackage['unidentified'][number] | undefined {
  return unidentified.find(({ exports }) => Object.values(exports).includes(declaration));
}

function ambiguousFailureAt(
  at: Path,
  [first, second]: readonly [ResolvedDefinitions, ResolvedDefinitions],
): DeclarationFailure {
  const both = `exported by both ${first.packageName} and ${second.packageName}`;
  const message = `A declaration belongs to one Definitions Package: ${both}, and neither imports it from the other`;
  return failure(at, 'definitions-ambiguous', message);
}

function unidentifiedFailureAt(at: Path, why: string): DeclarationFailure {
  const message = `A Definitions Package a declaration comes from has a name and a version: ${why}`;
  return failure(at, 'definitions-unidentified', message);
}
