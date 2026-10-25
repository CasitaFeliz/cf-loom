import { byCodePoint, type Origin, type Path } from '../walker/index.ts';
import { type Declarations, membersOf } from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { ResolvedDefinitions } from './validate.ts';

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
  const [first, second] = exporting;
  if (first === undefined) {
    return { kind: 'none' };
  }
  const origins = exporting.filter((resolved) => !reachesAnother(resolved, exporting));
  const [origin, other] = origins;
  if (origin !== undefined && other === undefined) {
    return { kind: 'found', package: origin };
  }
  const [one, two] =
    origin !== undefined && other !== undefined ? [origin, other] : [first, second ?? first];
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

/** A schema met where a declaration belongs to two Definitions Packages, neither importing it from the other. */
export type AmbiguousSchema = {
  readonly at: Path;
  readonly packages: readonly [ResolvedDefinitions, ResolvedDefinitions];
};

/**
 * Where each shared schema came from, as the walk writes it on the node: the package it belongs
 * to and the first name, in code point order, that package exports it under; a clone of one is a
 * new schema and has none. A schema two packages claim is recorded, once, where the walk first
 * meets it.
 */
export function schemaOriginsOf(packages: readonly ResolvedDefinitions[]) {
  const ambiguous: AmbiguousSchema[] = [];
  const met = new Set<unknown>();
  const originOf = (schema: unknown, at: Path): Origin | undefined => {
    const provenance = definitionsPackageOf(packages, schema);
    switch (provenance.kind) {
      case 'none':
        return undefined;
      case 'found':
        return `${originTextOf(provenance.package)}#${exportNameOf(provenance.package, schema)}`;
      case 'ambiguous':
        if (!met.has(schema)) {
          ambiguous.push({ at, packages: provenance.packages });
        }
        met.add(schema);
        return undefined;
    }
  };
  return { originOf, ambiguous };
}

function exportNameOf(resolved: ResolvedDefinitions, schema: unknown): string {
  const names = membersOf(resolved.exports)
    .schemas.filter(([, exported]) => exported === schema)
    .map(([name]) => name);
  return names.sort(byCodePoint)[0] ?? '';
}

/** Each reached Guard and code whose declaration two Definitions Packages export, neither importing it from the other. */
export function ambiguousFailures(
  { guards, codes }: Declarations,
  packages: readonly ResolvedDefinitions[],
): readonly DeclarationFailure[] {
  const declared = [
    ...guards.map(({ at, guard }) => ({ at, declaration: guard as unknown })),
    ...codes.map(({ at, rejections: [first] }) => ({
      at,
      declaration: first.rejection as unknown,
    })),
  ];
  return declared.flatMap(({ at, declaration }) => {
    const provenance = definitionsPackageOf(packages, declaration);
    return provenance.kind === 'ambiguous' ? [ambiguousFailureAt(at, provenance.packages)] : [];
  });
}

/** A schema two Definitions Packages claim, reported where the walk first met it. */
export function ambiguousSchemaFailure({ at, packages }: AmbiguousSchema): DeclarationFailure {
  return ambiguousFailureAt(at, packages);
}

function ambiguousFailureAt(
  at: Path,
  [first, second]: readonly [ResolvedDefinitions, ResolvedDefinitions],
): DeclarationFailure {
  const both = `exported by both ${first.packageName} and ${second.packageName}`;
  const message = `A declaration belongs to one Definitions Package: ${both}, and neither imports it from the other`;
  return failure(at, 'definitions-ambiguous', message);
}
