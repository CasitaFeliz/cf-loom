import { type Definitions, defineDefinitions } from '../src/index.ts';
import type {
  ImportedDefinitions,
  ResolvedDefinitions,
  RootPackage,
  Unidentified,
} from '../src/internal/index.ts';

/**
 * The package a test's root sits in: named as the root is, or `@org/definitions` for a
 * Definitions Package, with no Definitions Package installed and a root file that exports
 * nothing else, unless the test gives otherwise.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages: [],
    rootExports: {},
    ...given,
  };
}

/** A Definitions Package installed beside a test's root, exporting what is given beside its Definitions object. */
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

/** A Definitions Package installed beside a test's root whose package.json does not name it, exporting what is given. */
export function anUnidentifiedPackage(
  identity: Unidentified,
  exported: Readonly<Record<string, unknown>>,
  { definitions = defineDefinitions({}), reaches = [] }: Partial<Installed> = {},
): ImportedDefinitions {
  return { ...identity, definitions, exports: { definitions, ...exported }, reaches };
}

/** What a test gives of a package beside its identity: its Definitions object and the packages its files import. */
type Installed = Pick<ImportedDefinitions, 'definitions' | 'reaches'>;
