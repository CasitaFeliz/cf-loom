import type { Path } from '../walker/index.ts';
import type { Declarations } from './declarations.ts';
import type {
  LocatedDependencies,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
  Root,
} from './located.ts';
import { type ResolvedStandard, resolvedStandards } from './standard-codes.ts';

/** A Guard of a valid root, and whether the root reaches it. */
export type ValidatedGuard = LocatedGuard;

/** A code of a valid root: its first declaration, where it sits, and whether the root reaches it. */
export type ValidatedCode = {
  readonly code: string;
  readonly at: Path;
  readonly rejection: LocatedRejection['rejection'];
  readonly reached: boolean;
};

/**
 * The declarations of a valid root as gathered, in the root's order: the root itself, Endpoints
 * by identity, Guards and codes with whether the root reaches them, each code with its first
 * declaration, the Standard Rejections resolved, and the Dependencies by Provider. The Snapshot's
 * writer puts them in canonical form.
 */
export type ValidatedDeclarations = {
  readonly root: Root;
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly ValidatedGuard[];
  readonly codes: readonly ValidatedCode[];
  readonly standardRejections: readonly ResolvedStandard[];
  readonly dependencies: readonly LocatedDependencies[];
};

/** What a valid root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(declarations: Declarations): ValidatedDeclarations {
  return {
    root: declarations.root,
    endpoints: declarations.endpoints,
    guards: declarations.guards,
    codes: declarations.codes.map(({ code, at, rejections: [first], reached }) => ({
      code,
      at,
      rejection: first.rejection,
      reached,
    })),
    standardRejections: resolvedStandards(declarations),
    dependencies: declarations.dependencies,
  };
}
