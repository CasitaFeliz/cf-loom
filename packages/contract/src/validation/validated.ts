import type { Path } from '../walker/nodes.ts';
import type { Declarations } from './declarations.ts';
import type { LocatedEndpoint, LocatedGuard, LocatedRejection } from './located.ts';
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
 * The declarations of a valid root as gathered, in the root's order: Endpoints by identity,
 * Guards and codes with whether the root reaches them, each code with its first declaration,
 * and the Standard Rejections resolved. The Snapshot's writer puts them in canonical form.
 */
export type ValidatedDeclarations = {
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly ValidatedGuard[];
  readonly codes: readonly ValidatedCode[];
  readonly standardRejections: readonly ResolvedStandard[];
};

/** What a valid root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(declarations: Declarations): ValidatedDeclarations {
  return {
    endpoints: declarations.endpoints,
    guards: declarations.guards,
    codes: declarations.codes.map(({ code, at, rejections: [first], reached }) => ({
      code,
      at,
      rejection: first.rejection,
      reached,
    })),
    standardRejections: resolvedStandards(declarations),
  };
}
