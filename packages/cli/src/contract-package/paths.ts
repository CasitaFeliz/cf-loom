/** The files of every Contract Package, at fixed paths in it. */
export const packagePaths = {
  manifest: 'package.json',
  snapshot: 'snapshot.json',
  tsconfig: 'tsconfig.json',
  entry: 'src/index.ts',
  snapshotModule: 'src/snapshot.ts',
  standardRejections: 'src/standard-rejections.ts',
  defs: 'src/defs.ts',
} as const;

/** A kind of declaration the package writes one file for, by its name. */
export type DeclaredKind = 'endpoint' | 'guard' | 'rejection';

/** The folder of each kind of declaration's files. */
export const declaredFolders: Readonly<Record<DeclaredKind, string>> = {
  endpoint: 'src/endpoints',
  guard: 'src/guards',
  rejection: 'src/rejections',
};

const fixedPaths: ReadonlySet<string> = new Set(Object.values(packagePaths));

/** Whether a path in a package's folder is one `package` writes, in any Contract Package. */
export function isPackagePath(path: string): boolean {
  if (fixedPaths.has(path)) {
    return true;
  }
  return Object.values(declaredFolders).some((folder) => {
    const name = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : '';
    return name.endsWith('.ts') && !name.includes('/');
  });
}
