import type { Attachment, Endpoint, Guard } from '../declarations/index.ts';
import { isEndpoint, isGuard, isRejection } from '../declarations/index.ts';
import { fieldStep, indexStep, inside, type Place, placeOf, type Site } from '../walker/index.ts';
import type { LocatedCode, LocatedEndpoint, LocatedGuard, LocatedRejection } from './located.ts';
import { type Member, type Members, memberGuardsOf } from './members.ts';
import { reachedGuardsOf } from './reach.ts';
import { isPlainObject, listOf, textOf } from './written.ts';

/** What the Guards and Rejections of a Root are gathered from: its Endpoints and, for a Definitions Package, its members. */
type Sources = {
  readonly ownMembers: Members | undefined;
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
 * Every Guard a Root reaches by reference, each once, the Guards one lists before it: the
 * Endpoints' first, then those a Definitions Package exports.
 */
export function guardsOf(sources: Sources): readonly LocatedGuard[] {
  const { ownMembers, endpoints } = sources;
  const attached = endpoints.flatMap(({ endpoint }) => attachedGuardsOf(endpoint));
  const exported = ownMembers === undefined ? [] : memberGuardsOf(ownMembers);
  const places = guardPlacesOf(sources);
  return reachedGuardsOf([...attached, ...exported]).map((guard) => {
    const at = places.get(guard);
    if (at === undefined) {
      throw new Error('A Guard a Root reaches is attached or exported: a bug.');
    }
    return { at, guard };
  });
}

/**
 * Where each reached Guard sits: at its name, else at the first place that lists it, an
 * Endpoint's Attachment, another Guard's list or an export of a Definitions Package.
 */
function guardPlacesOf({ ownMembers, endpoints }: Sources): ReadonlyMap<Guard, Place> {
  const places = new Map<Guard, Place>();
  const visit = (guard: Guard, held: Place): void => {
    if (places.has(guard)) {
      return;
    }
    const name = guard.name;
    const at = placedBy(
      typeof name === 'string' ? { kind: 'guard', name } : undefined,
      held,
      guard,
    );
    places.set(guard, at);
    for (const [index, listed] of listOf<unknown>(guard.guards).entries()) {
      if (isGuard(listed)) {
        visit(listed, holdingAt(at, 'guards', index));
      }
    }
  };
  for (const { at, endpoint } of endpoints) {
    for (const [index, attachment] of listOf(endpoint.guards).entries()) {
      const guard = attachedGuardOf(attachment);
      if (guard !== undefined) {
        visit(guard, holdingAt(at, 'guards', index));
      }
    }
  }
  for (const member of ownMembers ?? []) {
    if (member.kind === 'guard') {
      visit(member.value, placeOf({ kind: 'export', name: member.name }, member.value));
    }
  }
  return places;
}

/** The place of an item of a list a declaration holds, by the field of the list and the position. */
function holdingAt(holder: Place, field: string, index: number): Place {
  return inside(holder, fieldStep(field), indexStep(index));
}

/** A declaration at its own site when its name is a string, else at the place that holds it. */
function placedBy(site: Site | undefined, held: Place, declaration: unknown): Place {
  return site === undefined ? { ...held, declaration } : placeOf(site, declaration);
}

/** A Rejection and the place that lists it: an export of a Definitions Package, or a list of a Guard or an Endpoint. */
type Listed = { readonly rejection: unknown; readonly held: Place };

/** Every Rejection a Root reaches, each once: a Guard's, an Endpoint's, then a Definitions Package's exports. */
export function rejectionsOf(
  { ownMembers, endpoints }: Sources,
  guards: readonly LocatedGuard[],
): readonly LocatedRejection[] {
  const exported = (ownMembers ?? []).flatMap(exportedRejectionOf);
  const ofGuards = guards.flatMap(({ at, guard }) => listedIn(at, guard.rejections));
  const ofEndpoints = endpoints.flatMap(({ at, endpoint }) => listedIn(at, endpoint.rejections));
  const seen = new Set<unknown>();
  const located: LocatedRejection[] = [];
  for (const { rejection, held } of [...ofGuards, ...ofEndpoints, ...exported]) {
    if (isRejection(rejection) && !seen.has(rejection)) {
      seen.add(rejection);
      const code = rejection.code;
      const site: Site | undefined = typeof code === 'string' ? { kind: 'code', code } : undefined;
      located.push({ at: placedBy(site, held, rejection), rejection });
    }
  }
  return located;
}

function exportedRejectionOf(member: Member): readonly Listed[] {
  if (member.kind !== 'rejection') {
    return [];
  }
  const held = placeOf({ kind: 'export', name: member.name }, member.value);
  return [{ rejection: member.value, held }];
}

function listedIn(holder: Place, rejections: unknown): readonly Listed[] {
  return listOf(rejections).map((rejection, index) => ({
    rejection,
    held: holdingAt(holder, 'rejections', index),
  }));
}

/** Each code a Root reaches once, with every declaration of it, in the order the Rejections were met. */
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
