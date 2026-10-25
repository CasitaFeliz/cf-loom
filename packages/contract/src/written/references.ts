import type { Attachment, Endpoint, Guard } from '../declarations/index.ts';
import { isEndpoint, isGuard, isRejection } from '../declarations/index.ts';
import type {
  LocatedCode,
  LocatedDefinitions,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
} from './located.ts';
import { reachedGuardsOf } from './reach.ts';
import { isPlainObject, listOf, textOf } from './written.ts';

/** What the Guards and Rejections of a root are gathered from: its Endpoints and, for a Definitions root, its members. */
type Sources = {
  readonly ownPackage: LocatedDefinitions | undefined;
  readonly endpoints: readonly LocatedEndpoint[];
};

/** The Guards an Endpoint attaches, each once, in Attachment order; what names no Guard is left out. */
export function attachedGuardsOf(endpoint: Endpoint): readonly Guard[] {
  return [...new Set(listOf(endpoint.guards).map(attachedGuardOf).filter(isGuard))];
}

/**
 * An Endpoint's Attachments as the runtime runs them: each Guard once, in order, with its
 * Qualifier, `undefined` when bare.
 */
export function attachmentsOf(
  endpoint: Endpoint,
): readonly { readonly guard: Guard; readonly qualifier: unknown }[] {
  return attachedGuardsOf(endpoint).map((guard) => ({
    guard,
    qualifier: qualifierOf(endpoint, guard),
  }));
}

function qualifierOf(endpoint: Endpoint, guard: Guard): unknown {
  const attachments: readonly unknown[] = listOf(endpoint.guards);
  const qualified = attachments.find(
    (attachment) => isPlainObject(attachment) && attachment['guard'] === guard,
  );
  return isPlainObject(qualified) ? qualified['qualifier'] : undefined;
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
 * Endpoints' first, then those a Definitions root exports.
 */
export function guardsOf({ ownPackage, endpoints }: Sources): readonly LocatedGuard[] {
  const attached = endpoints.flatMap(({ endpoint }) => attachedGuardsOf(endpoint));
  const exported = ownPackage?.members.guards ?? [];
  return reachedGuardsOf([...attached, ...exported]).map(locatedGuardOf);
}

/** Every Rejection a root reaches, each once: a Definitions root's exports, a Guard's, an Endpoint's. */
export function rejectionsOf(
  { ownPackage, endpoints }: Sources,
  guards: readonly LocatedGuard[],
): readonly LocatedRejection[] {
  const exported = ownPackage?.members.rejections ?? [];
  const ofGuards = guards.flatMap((located) => listOf(located.guard.rejections));
  const ofEndpoints = endpoints.flatMap((located) => listOf(located.endpoint.rejections));
  const rejections = [...exported, ...ofGuards, ...ofEndpoints].filter(isRejection);
  const distinct = [...new Set(rejections)];
  return distinct.map((rejection) => ({
    at: ['rejections', textOf(rejection.code)],
    rejection,
  }));
}

/** Each code a root reaches once, with every declaration of it, in the order the Rejections were met. */
export function codesOf(rejections: readonly LocatedRejection[]): readonly LocatedCode[] {
  const byCode = new Map<string, LocatedCode>();
  for (const located of rejections) {
    const code = textOf(located.rejection.code);
    const known = byCode.get(code);
    byCode.set(
      code,
      known === undefined
        ? { code, at: located.at, rejections: [located] }
        : { ...known, rejections: [...known.rejections, located] },
    );
  }
  return [...byCode.values()];
}

function locatedGuardOf(guard: Guard): LocatedGuard {
  return { at: ['guards', textOf(guard.name)], guard };
}
