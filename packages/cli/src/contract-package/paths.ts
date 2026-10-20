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

const declaredKinds = ['endpoint', 'guard', 'rejection', 'event'] as const;

/** A kind of declaration the package writes one file for, by its name. */
export type DeclaredKind = (typeof declaredKinds)[number];

/** The folder of each kind of declaration's files. */
export const declaredFolders: Readonly<Record<DeclaredKind, string>> = {
  endpoint: 'src/endpoints',
  guard: 'src/guards',
  rejection: 'src/rejections',
  event: 'src/events',
};

const fixedPaths: ReadonlySet<string> = new Set(Object.values(packagePaths));

/** The folder a package's build writes, `tsc -p` from `src`. */
export const builtFolder = 'dist';

/** A declaration's file name: its name in kebab-case, as the name grammars give it, then `.ts`. */
const kebabFileName = /^[a-z0-9]+(-[a-z0-9]+)*\.ts$/;

/** Each kind's file name; a Message Version's adds its version, as README's Layout names it. */
const declaredFileNames: Readonly<Record<DeclaredKind, RegExp>> = {
  endpoint: kebabFileName,
  guard: kebabFileName,
  rejection: kebabFileName,
  event: /^[a-z0-9]+(-[a-z0-9]+)*\.v[1-9][0-9]*\.ts$/,
};

/** Whether a path in a package's folder is one `package` writes, in any Contract Package. */
export function isPackagePath(path: string): boolean {
  if (fixedPaths.has(path)) {
    return true;
  }
  return declaredKinds.some((kind) => {
    const folder = declaredFolders[kind];
    const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : '';
    return declaredFileNames[kind].test(name);
  });
}

/** Whether a package.json is one `package` wrote: it carries the `cfLoom` metadata. */
export function isPackageManifest(manifest: unknown): boolean {
  return typeof manifest === 'object' && manifest !== null && 'cfLoom' in manifest;
}
