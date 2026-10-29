import { type Definitions, defineDefinitions } from '../src/index.ts';
import {
  type ImportedContractPackage,
  type ImportedDefinitions,
  providerOf,
  type ResolvedContractPackage,
  type ResolvedDefinitions,
  type RootPackage,
  type Unidentified,
} from '../src/internal/index.ts';

/**
 * The package a test's Root sits in: named as the Root is, or `@org/definitions` for a
 * Definitions Package, with no Definitions Package installed, every Provider whose Elements its
 * Dependencies and Subscriptions hold installed as a Contract Package at 1.0.0 exporting them, a
 * Service's own never, since it does not install its own Contract Package, and a Root file that
 * exports nothing else, unless the test gives otherwise.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages: [],
    contractPackages: providersOf(root)
      .filter(([provider]) => provider !== name)
      .map(([provider, elements]) => anInstalledContract(provider, elements)),
    rootExports: {},
    ...given,
  };
}

/** The Provided Elements a Root's Dependencies and Subscriptions hold, by their Provider's name. */
function providersOf(root: unknown): readonly (readonly [string, readonly unknown[]])[] {
  const byProvider = new Map<string, unknown[]>();
  for (const element of heldElementsOf(root)) {
    const provider = providerOf(element);
    if (provider !== undefined) {
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), element]);
    }
  }
  return [...byProvider];
}

function heldElementsOf(root: unknown): readonly unknown[] {
  const endpoints = listAt(root, 'dependencies').flatMap((dependency) =>
    listAt(dependency, 'endpoints'),
  );
  const events = listAt(root, 'groups')
    .flatMap((group) => listAt(group, 'subscriptions'))
    .map((subscription) => Reflect.get(Object(subscription), 'event'));
  return [...endpoints, ...events];
}

function listAt(holder: unknown, field: string): readonly unknown[] {
  const listed: unknown = Reflect.get(Object(holder), field);
  return Array.isArray(listed) ? listed : [];
}

/**
 * A Contract Package installed beside a test's Root, named `@org/contract-<provider>` at 1.0.0
 * unless given otherwise, whose modules export the Provided Elements given, a list or by name.
 */
export function anInstalledContract(
  provider: string,
  exported: readonly unknown[] | Readonly<Record<string, unknown>>,
  installed: Partial<ResolvedContractPackage> = {},
): ResolvedContractPackage {
  return {
    kind: 'identified',
    packageName: `@org/contract-${provider}`,
    version: '1.0.0',
    elements: Object.values(exported),
    reaches: [],
    ...installed,
  };
}

/** A Contract Package installed beside a test's Root whose package.json does not name it. */
export function anUnidentifiedContract(
  identity: Unidentified,
  exported: readonly unknown[] | Readonly<Record<string, unknown>>,
  reaches: readonly ImportedContractPackage[] = [],
): ImportedContractPackage {
  return { ...identity, elements: Object.values(exported), reaches };
}

/** A Definitions Package installed beside a test's Root, exporting what is given beside its Definitions object. */
export function anInstalledPackage(
  definitions: Definitions,
  exported: Readonly<Record<string, unknown>>,
  installed: Partial<ResolvedDefinitions> = {},
): ResolvedDefinitions {
  return {
    kind: 'identified',
    definitions,
    packageName: '@org/definitions',
    version: '4.2.0',
    exports: { definitions, ...exported },
    reaches: [],
    ...installed,
  };
}

/** A Definitions Package installed beside a test's Root whose package.json does not name it, exporting what is given. */
export function anUnidentifiedPackage(
  identity: Unidentified,
  exported: Readonly<Record<string, unknown>>,
  { definitions = defineDefinitions({}), reaches = [] }: Partial<Installed> = {},
): ImportedDefinitions {
  return { ...identity, definitions, exports: { definitions, ...exported }, reaches };
}

/** What a test gives of a package beside its identity: its Definitions object and the packages its files import. */
type Installed = Pick<ImportedDefinitions, 'definitions' | 'reaches'>;
