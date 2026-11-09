import type { RootKind } from '@cf-loom/contract/internal';

/** Where a kind of Root sits in its project, the name `init` writes it under, the function that declares it and what a sentence calls it. */
export type RootPlace = {
  readonly noun: "a Service's Contract" | "an Application's Contract" | 'a Definitions Package';
  readonly file: 'src/contract/index.ts' | 'src/definitions/index.ts';
  readonly exported: 'contract' | 'application' | 'definitions';
  readonly define: 'defineService' | 'defineApplication' | 'defineDefinitions';
};

/** Each kind of Root's file, export and declaration, which `init` writes and the loader names. */
export const rootPlaces: Readonly<Record<RootKind, RootPlace>> = {
  service: {
    noun: "a Service's Contract",
    file: 'src/contract/index.ts',
    exported: 'contract',
    define: 'defineService',
  },
  application: {
    noun: "an Application's Contract",
    file: 'src/contract/index.ts',
    exported: 'application',
    define: 'defineApplication',
  },
  definitions: {
    noun: 'a Definitions Package',
    file: 'src/definitions/index.ts',
    exported: 'definitions',
    define: 'defineDefinitions',
  },
};

/** Every file a Root may sit in, each once. */
export const rootFiles: readonly RootPlace['file'][] = [
  ...new Set(Object.values(rootPlaces).map(({ file }) => file)),
];

/** Whether a word names a kind of Root. */
export function isRootKind(kind: string): kind is RootKind {
  return Object.hasOwn(rootPlaces, kind);
}
