import type { Attachment, Endpoint, Guard } from '../declarations/index.ts';
import { isGuard, isRejection } from '../declarations/index.ts';
import type {
  LocatedCode,
  LocatedDefinitions,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
  Root,
} from './located.ts';
import { isPlainObject, listOf, textOf } from './written.ts';

/** What the Guards and Rejections of a root are gathered from. */
type Sources = {
  readonly root: Root;
  readonly allPackages: readonly LocatedDefinitions[];
  readonly endpoints: readonly LocatedEndpoint[];
};

/** The Guards an Endpoint attaches, each once, in Attachment order; what names no Guard is left out. */
export function attachedGuardsOf(endpoint: Endpoint): readonly Guard[] {
  return [...new Set(listOf(endpoint.guards).map(attachedGuardOf).filter(isGuard))];
}

/** The Guard an Attachment names, bare or qualified; nothing when it names no Guard at all. */
export function attachedGuardOf(attachment: Attachment): Guard | undefined {
  if (isGuard(attachment)) {
    return attachment;
  }
  if (isPlainObject(attachment) && isGuard(attachment.guard)) {
    return attachment.guard;
  }
  return undefined;
}

/**
 * Every Guard a root reaches by reference, each once, the Guards one lists before it: the
 * Endpoints' first, which the root reaches, then a listed Definitions Package's, reached only by a
 * Definitions root.
 */
export function guardsOf({ root, allPackages, endpoints }: Sources): readonly LocatedGuard[] {
  const attached = endpoints.flatMap((located) => attachedGuardsOf(located.endpoint));
  const listed = allPackages.flatMap((located) => listOf(located.definitions.guards));
  const gathered: LocatedGuard[] = [];
  const seen = new Set<Guard>();
  for (const guard of attached) {
    gatherGuard({ guard, reached: true }, seen, gathered);
  }
  for (const guard of listed) {
    gatherGuard({ guard, reached: root.kind === 'definitions' }, seen, gathered);
  }
  return gathered;
}

/** Every Rejection a root reaches, each once: a Definitions Package's, a Guard's, an Endpoint's. */
export function rejectionsOf(
  { allPackages, endpoints }: Sources,
  guards: readonly LocatedGuard[],
): readonly LocatedRejection[] {
  const listed = allPackages.flatMap((located) => listOf(located.definitions.rejections));
  const ofGuards = guards.flatMap((located) => listOf(located.guard.rejections));
  const ofEndpoints = endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const rejections = [...listed, ...ofGuards, ...ofEndpoints].filter(isRejection);
  const distinct = [...new Set(rejections)];
  return distinct.map((rejection) => ({
    at: ['rejections', textOf(rejection.code)],
    rejection,
  }));
}

/** Each code once, with every declaration of it, reached when an Endpoint or a reached Guard answers it. */
export function codesOf(
  { root, endpoints }: Sources,
  gathered: {
    readonly guards: readonly LocatedGuard[];
    readonly rejections: readonly LocatedRejection[];
  },
): readonly LocatedCode[] {
  const reached = reachedCodesOf(endpoints, gathered.guards);
  const everything = root.kind === 'definitions';
  const byCode = new Map<string, LocatedCode>();
  for (const located of gathered.rejections) {
    const code = textOf(located.rejection.code);
    const known = byCode.get(code);
    byCode.set(
      code,
      known === undefined
        ? { code, at: located.at, rejections: [located], reached: everything || reached.has(code) }
        : { ...known, rejections: [...known.rejections, located] },
    );
  }
  return [...byCode.values()];
}

function gatherGuard(
  { guard, reached }: Pick<LocatedGuard, 'guard' | 'reached'>,
  seen: Set<Guard>,
  gathered: LocatedGuard[],
): void {
  if (!isGuard(guard) || seen.has(guard)) {
    return;
  }
  seen.add(guard);
  for (const listed of listOf(guard.guards)) {
    gatherGuard({ guard: listed, reached }, seen, gathered);
  }
  gathered.push({ at: ['guards', textOf(guard.name)], guard, reached });
}

function reachedCodesOf(
  endpoints: readonly LocatedEndpoint[],
  guards: readonly LocatedGuard[],
): ReadonlySet<string> {
  const ofEndpoints = endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const ofGuards = guards
    .filter((located) => located.reached)
    .flatMap((located) => listOf(located.guard.rejections));
  const rejections = [...ofEndpoints, ...ofGuards].filter(isRejection);
  return new Set(rejections.map((rejection) => textOf(rejection.code)));
}
