import type { Attachment, Endpoint, Guard } from '../declarations/index.ts';
import { isEndpoint, isGuard, isRejection } from '../declarations/index.ts';
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

/**
 * The Guards whose Context a Handler receives, each once, in order: an Endpoint's attached ones,
 * or the ones a Guard lists, that provide a Context.
 */
export function contextProvidersOf(element: Endpoint | Guard): readonly Guard[] {
  const guards = isEndpoint(element) ? attachedGuardsOf(element) : listOf(element.guards);
  return [...new Set(guards.filter(isGuard))].filter((guard) => guard.context !== undefined);
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
  const attached = reachedGuardsOf(endpoints.flatMap(({ endpoint }) => attachedGuardsOf(endpoint)));
  const listed = reachedGuardsOf(
    allPackages.flatMap(({ definitions }) => listOf(definitions.guards)),
  );
  const listedOnly = listed.filter((guard) => !attached.includes(guard));
  return [
    ...attached.map((guard) => locatedGuardOf(guard, true)),
    ...listedOnly.map((guard) => locatedGuardOf(guard, root.kind === 'definitions')),
  ];
}

/**
 * Every Guard the given ones reach, each once, the Guards one lists before it: themselves and,
 * through `guards`, the ones they name; what names no Guard is left out.
 */
export function reachedGuardsOf(guards: readonly unknown[]): readonly Guard[] {
  const seen = new Set<Guard>();
  const reached: Guard[] = [];
  const visit = (guard: unknown): void => {
    if (!isGuard(guard) || seen.has(guard)) {
      return;
    }
    seen.add(guard);
    listOf(guard.guards).forEach(visit);
    reached.push(guard);
  };
  guards.forEach(visit);
  return reached;
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

function locatedGuardOf(guard: Guard, reached: boolean): LocatedGuard {
  return { at: ['guards', textOf(guard.name)], guard, reached };
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
