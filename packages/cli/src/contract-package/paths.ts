/** The files of every Contract Package, at fixed paths in it. */
export const packagePaths = {
  manifest: 'package.json',
  snapshot: 'snapshot.json',
  tsconfig: 'tsconfig.json',
  entry: 'src/index.ts',
  exportedSnapshot: 'src/exported-snapshot.ts',
  standardRejections: 'src/standard-rejections.ts',
  defs: 'src/defs.ts',
} as const;

/** A kind of declaration the package writes one file for, by its name. */
export type DeclaredKind = 'endpoint' | 'guard' | 'rejection' | 'event';

/** The folder of each kind of declaration's files. */
export const declaredFolders: Readonly<Record<DeclaredKind, string>> = {
  endpoint: 'src/endpoints',
  guard: 'src/guards',
  rejection: 'src/rejections',
  event: 'src/events',
};

/** The folder a package's build writes, `tsc -p` from `src`. */
export const builtFolder = 'dist';

/** Whether a package.json is one `package` wrote: it carries the `cfLoom` metadata. */
export function isPackageManifest(manifest: unknown): boolean {
  return typeof manifest === 'object' && manifest !== null && 'cfLoom' in manifest;
}
