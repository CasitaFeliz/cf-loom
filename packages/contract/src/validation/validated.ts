import type { Guard } from '../guard.ts';
import { isGuard, isRejection } from '../predicates.ts';
import type { Rejection } from '../rejection.ts';
import { byCanonicalJson } from '../walker/canonical-json.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations, LocatedEndpoint, LocatedGuard } from './declarations.ts';
import { attachedGuardOf } from './declarations.ts';
import { type ResolvedStandard, resolvedStandards } from './standard-codes.ts';
import { listOf, textOf } from './written.ts';

/** A Guard of a valid root, and whether an Endpoint reaches it, directly or through a Guard's `guards`. */
export type ValidatedGuard = LocatedGuard & { readonly reached: boolean };

/** A code of a valid root: its first declaration, where it sits, and whether an Endpoint or a reached Guard answers it. */
export type ValidatedCode = {
  readonly code: string;
  readonly at: Path;
  readonly rejection: Rejection;
  readonly reached: boolean;
};

/**
 * The declarations of a valid root as the Snapshot writes them: Endpoints by identity, Guards and
 * codes with whether the Contract reaches them (a Definitions Package reaches all of its own),
 * codes by code point with the first declaration of each, and the Standard Rejections resolved.
 */
export type ValidatedDeclarations = {
  readonly endpoints: readonly LocatedEndpoint[];
  readonly guards: readonly ValidatedGuard[];
  readonly codes: readonly ValidatedCode[];
  readonly standardRejections: readonly ResolvedStandard[];
};

/** What a valid root declares, so the Snapshot's writer never gathers it again. */
export function validatedDeclarationsOf(declarations: Declarations): ValidatedDeclarations {
  const reachedGuards = reachedGuardsOf(declarations);
  const reachedCodes = reachedCodesOf(declarations, reachedGuards);
  const everything = declarations.root.kind === 'definitions';
  return {
    endpoints: declarations.endpoints,
    guards: declarations.guards.map((located) => ({
      ...located,
      reached: everything || reachedGuards.has(located.guard),
    })),
    codes: codesOf(declarations).map((code) => ({
      ...code,
      reached: everything || reachedCodes.has(code.code),
    })),
    standardRejections: resolvedStandards(declarations.standardRejections),
  };
}

/** The Guards the Endpoints attach, and the Guards those list, through any depth. */
function reachedGuardsOf({ endpoints }: Declarations): ReadonlySet<Guard> {
  const reached = new Set<Guard>();
  const attached = endpoints.flatMap((located) => listOf(located.endpoint.guards));
  for (const guard of attached.map(attachedGuardOf).filter(isGuard)) {
    reachGuard(guard, reached);
  }
  return reached;
}

function reachGuard(guard: Guard, reached: Set<Guard>): void {
  if (reached.has(guard)) {
    return;
  }
  reached.add(guard);
  for (const listed of listOf(guard.guards).filter(isGuard)) {
    reachGuard(listed, reached);
  }
}

/** The codes the Endpoints answer themselves or through a reached Guard. */
function reachedCodesOf(
  { endpoints }: Declarations,
  reachedGuards: ReadonlySet<Guard>,
): ReadonlySet<string> {
  const ofEndpoints = endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const ofGuards = [...reachedGuards].flatMap((guard) => listOf(guard.rejections));
  const rejections = [...ofEndpoints, ...ofGuards].filter(isRejection);
  return new Set(rejections.map((rejection) => textOf(rejection.code)));
}

/** Each code once, as its first declaration in the root's order, sorted by code point. */
function codesOf({ rejections }: Declarations): readonly Omit<ValidatedCode, 'reached'>[] {
  const firstByCode = new Map<string, Omit<ValidatedCode, 'reached'>>();
  for (const { at, rejection } of rejections) {
    const code = textOf(rejection.code);
    if (!firstByCode.has(code)) {
      firstByCode.set(code, { code, at, rejection });
    }
  }
  return [...firstByCode.values()].sort((left, right) => byCanonicalJson(left.code, right.code));
}
