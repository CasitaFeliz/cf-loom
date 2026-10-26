import { type ContractPackage, type Definitions, defineDefinitions } from '../src/index.ts';
import {
  type ImportedContractPackage,
  type ImportedDefinitions,
  isContractPackage,
  type ResolvedContractPackage,
  type ResolvedDefinitions,
  type RootPackage,
  type Unidentified,
} from '../src/internal/index.ts';

/**
 * The package a test's Root sits in: named as the Root is, or `@org/definitions` for a
 * Definitions Package, with no Definitions Package installed, every Provider of its Dependencies
 * installed as a Contract Package at 1.0.0, and a Root file that exports nothing else, unless the
 * test gives otherwise.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages: [],
    contractPackages: providersOf(root).map((provider) => anInstalledContract(provider)),
    rootExports: {},
    ...given,
  };
}

/** The Contract Package each Dependency of a Root holds, once for each Provider. */
function providersOf(root: unknown): readonly ContractPackage[] {
  const dependencies: unknown =
    typeof root === 'object' && root !== null ? Reflect.get(root, 'dependencies') : undefined;
  const listed = Array.isArray(dependencies) ? dependencies : [];
  const providers: unknown[] = listed.map((dependency) =>
    Reflect.get(Object(dependency), 'provider'),
  );
  const packages = providers.filter(isContractPackage);
  return packages.filter(
    ({ name }, index) => packages.findIndex((other) => other.name === name) === index,
  );
}

/** A Contract Package installed beside a test's Root, as its package.json names it, exporting the `contract` given. */
export function anInstalledContract(
  contract: ContractPackage,
  installed: Partial<ResolvedContractPackage> = {},
): ResolvedContractPackage {
  return {
    kind: 'identified',
    packageName: `@org/contract-${contract.name}`,
    version: '1.0.0',
    contract,
    reaches: [],
    ...installed,
  };
}

/** A Contract Package installed beside a test's Root whose package.json does not name it. */
export function anUnidentifiedContract(
  identity: Unidentified,
  contract: ContractPackage,
  reaches: readonly ImportedContractPackage[] = [],
): ImportedContractPackage {
  return { ...identity, contract, reaches };
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
