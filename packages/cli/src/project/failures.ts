import type { Failure } from '@casitafeliz/loom-contract/internal';

/** Where and when a command runs, passed in so a run depends on nothing else. */
export type Run = { readonly cwd: string; readonly now: number };

/** A project that cannot be used: a tooling error in one line. */
export type Tooling = { readonly kind: 'tooling'; readonly message: string };

/** A root that breaks the Contract's rules, every failure at once. */
export type Invalid = {
  readonly kind: 'invalid';
  readonly failures: readonly [Failure, ...Failure[]];
};

/** Why a project could not be built: its rules broken, or a tooling error. */
export type ProjectFailure = Invalid | Tooling;

/** A tooling error. */
export function tooling(message: string): Tooling {
  return { kind: 'tooling', message };
}
