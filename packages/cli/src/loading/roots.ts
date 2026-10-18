/** The kinds of root a project has, as `init` names them. */
export const rootKinds = ['service', 'application', 'definitions'] as const;

/** A kind of root a project has. */
export type RootKind = (typeof rootKinds)[number];

/** Where a kind of root sits in its project and the name its root file exports it under. */
export type RootPlace = {
  readonly file: 'src/contract/index.ts' | 'src/definitions/index.ts';
  readonly exported: 'contract' | 'application' | 'definitions';
  readonly define: 'defineContract' | 'defineApplication' | 'defineDefinitions';
};

/**
 * Each kind of root's file, export and declaration: the one place `init` writes them and the
 * loader reads them.
 */
export const rootPlaces: Readonly<Record<RootKind, RootPlace>> = {
  service: { file: 'src/contract/index.ts', exported: 'contract', define: 'defineContract' },
  application: {
    file: 'src/contract/index.ts',
    exported: 'application',
    define: 'defineApplication',
  },
  definitions: {
    file: 'src/definitions/index.ts',
    exported: 'definitions',
    define: 'defineDefinitions',
  },
};

/** Every file a root may sit in, each once. */
export const rootFiles: readonly RootPlace['file'][] = [
  ...new Set(Object.values(rootPlaces).map(({ file }) => file)),
];

/** Whether a word names a kind of root. */
export function isRootKind(kind: string): kind is RootKind {
  const kinds: readonly string[] = rootKinds;
  return kinds.includes(kind);
}
