import { isEndpoint, providerOf } from '../declarations/index.ts';
import type { Place } from '../walker/index.ts';
import { type Declarations, listOf } from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { identityLineOf, originAmong, type Provenance, packageLabelOf } from './provenance.ts';
import type { ImportedContractPackage } from './validate.ts';

/**
 * A Provider a Contract uses: the Provided Elements of it that its Dependencies list and its
 * Subscriptions receive, each once, and the place of each Dependency and Subscription holding one.
 */
export type UsedProvider = {
  readonly name: string;
  readonly elements: readonly unknown[];
  readonly holders: readonly Place[];
};

/** Every Provider whose Elements a Root's Dependencies and Subscriptions hold, in the order first met. */
export function usedProvidersOf({
  dependencies,
  subscriptions,
}: Pick<Declarations, 'dependencies' | 'subscriptions'>): readonly UsedProvider[] {
  const used = new Map<string, { elements: unknown[]; holders: Place[] }>();
  const hold = (at: Place, element: unknown) => {
    const name = providerOf(element);
    if (name === undefined) {
      return;
    }
    const provider = used.get(name) ?? { elements: [], holders: [] };
    pushOnce(provider.elements, element);
    pushOnce(provider.holders, at);
    used.set(name, provider);
  };
  for (const { at, dependency } of dependencies) {
    for (const endpoint of listOf<unknown>(dependency.endpoints).filter(isEndpoint)) {
      hold(at, endpoint);
    }
  }
  for (const { at, subscription } of subscriptions) {
    hold(at, subscription.event);
  }
  return [...used].map(([name, { elements, holders }]) => ({ name, elements, holders }));
}

function pushOnce<Item>(items: Item[], item: Item): void {
  if (!items.includes(item)) {
    items.push(item);
  }
}

/**
 * The installed Contract Package a Provider's Elements come from: the one among those imported
 * that exports an Element the Contract uses of it and imports it from none of the others that do.
 */
export function contractPackageOf(
  packages: readonly ImportedContractPackage[],
  provider: UsedProvider,
): Provenance<ImportedContractPackage> {
  const exporting = packages.filter(({ elements }) =>
    provider.elements.some((element) => elements.includes(element)),
  );
  return originAmong(exporting);
}

/**
 * For each Provider no one installed Contract Package can be named for (none exports its Elements,
 * two export them and neither imports them from the other, or the one that does has no name or
 * version in its package.json, which `against` records), one failure at each Dependency and
 * Subscription holding one of its Elements.
 */
export function dependencyPackageFailures(
  declarations: Declarations,
  packages: readonly ImportedContractPackage[],
): readonly DeclarationFailure[] {
  const failures: DeclarationFailure[] = [];
  for (const provider of usedProvidersOf(declarations)) {
    const message = problemOf(contractPackageOf(packages, provider), provider.name);
    if (message !== undefined) {
      failures.push(...provider.holders.map((at) => failure(at, 'dependency-package', message)));
    }
  }
  return failures;
}

/** What keeps a Provider's Contract Package from being named, in a sentence. */
function problemOf(
  provenance: Provenance<ImportedContractPackage>,
  provider: string,
): string | undefined {
  switch (provenance.kind) {
    case 'origin':
      return identityProblemOf(provenance.package, provider);
    case 'none':
      return `A Provider's Elements come from an installed Contract Package: no installed package exports ${provider}'s Elements`;
    case 'ambiguous': {
      const [first, second] = provenance.packages.map(packageLabelOf);
      const both = `exported by both ${first} and ${second}, and neither imports them from the other`;
      return `A Provider's Elements come from one Contract Package: ${provider}'s Elements are ${both}`;
    }
  }
}

/** What a package.json lacks to name a Provider's Contract Package, in a sentence; none when it names it. */
function identityProblemOf(origin: ImportedContractPackage, provider: string): string | undefined {
  switch (origin.kind) {
    case 'identified':
      return undefined;
    case 'unnamed':
    case 'unversioned':
      return `A Provider's Contract Package has a name and a version: ${provider}'s, ${identityLineOf(origin)}`;
  }
}
