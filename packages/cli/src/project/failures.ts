import type { Failure } from '@cf-loom/contract/internal';

/** A project that cannot be used: a tooling error in one line. */
export type Tooling = { readonly kind: 'tooling'; readonly message: string };

/** The file under the project that exports a declaration, when the project's files say; none otherwise. */
export type FileOf = (declaration: unknown) => string | undefined;

/** A Root that breaks the Contract's rules, every failure at once, and where the files that declare them are. */
export type Invalid = {
  readonly kind: 'invalid';
  readonly failures: readonly [Failure, ...Failure[]];
  readonly fileOf: FileOf;
};

/** A Root's failures with no file to name. */
export function invalid(failures: readonly [Failure, ...Failure[]]): Invalid {
  return { kind: 'invalid', failures, fileOf: () => undefined };
}

/** Why a project could not be built: its rules broken, or a tooling error. */
export type ProjectFailure = Invalid | Tooling;

/** A tooling error. */
export function tooling(message: string): Tooling {
  return { kind: 'tooling', message };
}
