import type { Place } from '../walker/index.ts';
import {
  type Declarations,
  type ResolvedStandard,
  resolvedStandards,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { definitionsPackageOf, originTextOf, packageLabelOf } from './provenance.ts';
import type { ImportedDefinitions } from './validate.ts';

/** Where a code is first declared, and where each of its declarations came from. */
type Declared = { readonly at: Place; readonly named: readonly string[] };

/**
 * A code is declared once: by one Rejection the Root reaches, or one Standard Rejection resolving
 * to it. A code with more fails once, naming every declaration by where it came from.
 */
export function codeOnceFailures(
  declarations: Declarations,
  packages: readonly ImportedDefinitions[],
): readonly DeclarationFailure[] {
  const standards = resolvedStandards(declarations);
  const declaredByCode = new Map<string, Declared>();
  for (const { code, at, rejections } of declarations.codes) {
    const named = rejections.map(({ rejection }) => sourceOf(declarations, packages, rejection));
    declaredByCode.set(code, { at, named });
  }
  for (const standard of standards) {
    const known = declaredByCode.get(standard.code);
    const named = [...(known?.named ?? []), standardSourceOf(standard)];
    declaredByCode.set(standard.code, { at: known?.at ?? standard.at, named });
  }
  const repeated = [...declaredByCode].filter(([, { named }]) => named.length > 1);
  return repeated.map(([code, { at, named }]) =>
    failure(at, 'code-once', `A code is declared once: ${code} (${listOf(named)})`),
  );
}

/** Where a declared Rejection came from, as the line names it. */
function sourceOf(
  { root }: Declarations,
  packages: readonly ImportedDefinitions[],
  rejection: unknown,
): string {
  const provenance = definitionsPackageOf(packages, rejection);
  switch (provenance.kind) {
    case 'origin':
      return sourceNamedBy(provenance.package);
    case 'none':
    case 'ambiguous':
      return root.kind === 'definitions' ? 'the Definitions Package' : 'the Contract';
  }
}

/** The package a Rejection came from, as an origin names it, or as its package.json's name or path when it lacks a name or a version. */
function sourceNamedBy(origin: ImportedDefinitions): string {
  switch (origin.kind) {
    case 'identified':
      return originTextOf(origin);
    case 'unnamed':
    case 'unversioned':
      return packageLabelOf(origin);
  }
}

function standardSourceOf({ name }: ResolvedStandard): string {
  return `the ${textOf(name)} Standard Rejection`;
}

/** The sources in the order met, each once, with how many declarations it gave: `the Contract, twice`. */
function listOf(named: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const source of named) {
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts].map(([source, count]) => `${source}${timesOf(count)}`).join(' and ');
}

function timesOf(count: number): string {
  if (count === 1) {
    return '';
  }
  return count === 2 ? ', twice' : `, ${count} times`;
}
