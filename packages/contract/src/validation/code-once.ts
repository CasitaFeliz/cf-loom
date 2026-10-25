import {
  type Declarations,
  type ResolvedStandard,
  resolvedStandards,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { definitionsPackageOf, originTextOf } from './provenance.ts';
import type { ResolvedDefinitions } from './validate.ts';

/**
 * A code is declared once: by one Rejection the root reaches, or one Standard Rejection resolving
 * to it. A code with more fails once, naming every declaration by where it came from.
 */
export function codeOnceFailures(
  declarations: Declarations,
  packages: readonly ResolvedDefinitions[],
): readonly DeclarationFailure[] {
  const standards = resolvedStandards(declarations);
  const sourcesByCode = new Map<string, string[]>();
  for (const { code, rejections } of declarations.codes) {
    const named = rejections.map(({ rejection }) => sourceOf(declarations, packages, rejection));
    sourcesByCode.set(code, named);
  }
  for (const standard of standards) {
    const named = sourcesByCode.get(standard.code) ?? [];
    sourcesByCode.set(standard.code, [...named, standardSourceOf(standard)]);
  }
  const repeated = [...sourcesByCode].filter(([, named]) => named.length > 1);
  return repeated.map(([code, named]) =>
    failure(
      ['rejections', code],
      'code-once',
      `A code is declared once: ${code} (${listOf(named)})`,
    ),
  );
}

/** Where a declared Rejection came from, as the line names it. */
function sourceOf(
  { root }: Declarations,
  packages: readonly ResolvedDefinitions[],
  rejection: unknown,
): string {
  const provenance = definitionsPackageOf(packages, rejection);
  if (provenance.kind === 'found') {
    return originTextOf(provenance.package);
  }
  return root.kind === 'definitions' ? 'the Definitions Package' : 'the Contract';
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
