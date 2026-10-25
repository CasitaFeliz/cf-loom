/** A package's name as its package.json writes it: the scope, when it has one, and the name. */
export type PackageNameParts = { readonly scope: string | undefined; readonly name: string };

/** The scope and the unscoped name of a package name: `@org/definitions` is `@org` and `definitions`. */
export function packageNamePartsOf(packageName: string): PackageNameParts {
  if (!packageName.startsWith('@')) {
    return { scope: undefined, name: packageName };
  }
  const [scope, ...rest] = packageName.split('/');
  return { scope, name: rest.join('/') };
}
