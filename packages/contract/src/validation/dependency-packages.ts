import type { Dependency } from '../declarations/index.ts';
import {
  type Declarations,
  type LocatedDependency,
  providerExportsOf,
  providerNameOf,
} from '../written/index.ts';
import { isContractPackage } from './dependencies.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { identityLineOf, originAmong, type Provenance, packageLabelOf } from './provenance.ts';
import type { ImportedContractPackage } from './validate.ts';

/**
 * The installed Contract Package a Dependency's Provider is: the one among those imported that
 * exports an Element the Dependency holds and imports it from none of the others that do.
 */
export function contractPackageOf(
  packages: readonly ImportedContractPackage[],
  dependency: Dependency,
): Provenance<ImportedContractPackage> {
  const { endpoints, events } = providerExportsOf(dependency);
  const elements = [...endpoints, ...events];
  const exporting = packages.filter(({ contract }) => {
    const exported: readonly unknown[] = [
      ...Object.values(contract.endpoints),
      ...Object.values(contract.events),
    ];
    return elements.some((element) => exported.includes(element));
  });
  return originAmong(exporting);
}

/**
 * Each Dependency whose Provider no one installed Contract Package can be named for: none exports
 * its Elements, two export them and neither imports them from the other, or the one that does has
 * no name or version in its package.json, which `against` records.
 */
export function dependencyPackageFailures(
  { dependencies }: Declarations,
  packages: readonly ImportedContractPackage[],
): readonly DeclarationFailure[] {
  const failures: DeclarationFailure[] = [];
  for (const located of dependencies) {
    const found = failureOf(located, packages);
    if (found !== undefined) {
      failures.push(found);
    }
  }
  return failures;
}

/** The failure of a Dependency whose package cannot be named; its provider being no Contract Package is another rule's. */
function failureOf(
  { at, dependency }: LocatedDependency,
  packages: readonly ImportedContractPackage[],
): DeclarationFailure | undefined {
  if (!isContractPackage(dependency.provider)) {
    return undefined;
  }
  const provenance = contractPackageOf(packages, dependency);
  const message = problemOf(provenance, providerNameOf(dependency) ?? '');
  return message === undefined ? undefined : failure(at, 'dependency-package', message);
}

/** What keeps a Dependency's Contract Package from being named, in a sentence. */
function problemOf(
  provenance: Provenance<ImportedContractPackage>,
  provider: string,
): string | undefined {
  switch (provenance.kind) {
    case 'origin':
      return identityProblemOf(provenance.package);
    case 'none':
      return `A Dependency's provider is an installed Contract Package's contract: no installed package exports ${provider}'s Elements`;
    case 'ambiguous': {
      const [first, second] = provenance.packages.map(packageLabelOf);
      const both = `exported by both ${first} and ${second}, and neither imports them from the other`;
      return `A Dependency's Contract Package is one package: ${provider}'s Elements are ${both}`;
    }
  }
}

/** What a package.json lacks to name the Contract Package, in a sentence; none when it names it. */
function identityProblemOf(origin: ImportedContractPackage): string | undefined {
  switch (origin.kind) {
    case 'identified':
      return undefined;
    case 'unnamed':
    case 'unversioned':
      return `A Dependency's Contract Package has a name and a version: ${identityLineOf(origin)}`;
  }
}
