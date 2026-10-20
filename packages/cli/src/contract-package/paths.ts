/** The files of every Contract Package, at fixed paths in it. */
export const packagePaths = {
  manifest: 'package.json',
  snapshot: 'snapshot.json',
  tsconfig: 'tsconfig.json',
  entry: 'src/index.ts',
  snapshotModule: 'src/snapshot.ts',
  exportedSnapshot: 'src/exported-snapshot.ts',
  standardRejections: 'src/standard-rejections.ts',
  defs: 'src/defs.ts',
} as const;

/** A kind of declaration the package writes one file for, by its name. */
export type DeclaredKind = 'endpoint' | 'guard' | 'rejection' | 'event';

/** A name in kebab-case, as the name grammars give it. */
const kebabName = '[a-z0-9]+(-[a-z0-9]+)*';

/** A declaration's file name: its name in kebab-case, then `.ts`. */
const kebabFileName = new RegExp(`^${kebabName}\\.ts$`);

/**
 * The folder of each kind of declaration's files, and their names; a Message Version's adds its
 * version, as README's Layout names it.
 */
export const declaredFiles: Readonly<
  Record<DeclaredKind, { readonly folder: string; readonly fileName: RegExp }>
> = {
  endpoint: { folder: 'src/endpoints', fileName: kebabFileName },
  guard: { folder: 'src/guards', fileName: kebabFileName },
  rejection: { folder: 'src/rejections', fileName: kebabFileName },
  event: { folder: 'src/events', fileName: new RegExp(`^${kebabName}\\.v[1-9][0-9]*\\.ts$`) },
};

const fixedPaths: ReadonlySet<string> = new Set(Object.values(packagePaths));

/** The folder a package's build writes, `tsc -p` from `src`. */
export const builtFolder = 'dist';

/** Whether a path in a package's folder is one `package` writes, in any Contract Package. */
export function isPackagePath(path: string): boolean {
  if (fixedPaths.has(path)) {
    return true;
  }
  return Object.values(declaredFiles).some(({ folder, fileName }) => {
    const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : '';
    return fileName.test(name);
  });
}

/** Whether a package.json is one `package` wrote: it carries the `cfLoom` metadata. */
export function isPackageManifest(manifest: unknown): boolean {
  return typeof manifest === 'object' && manifest !== null && 'cfLoom' in manifest;
}
