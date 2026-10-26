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

/** The Guards and Rejections a Root reaches by reference, each once, placed by their lists. */
export type References = {
  readonly guards: readonly LocatedGuard[];
  readonly rejections: readonly LocatedRejection[];
};

/**
 * Every Guard and Rejection a Root reaches by reference, each once: the Guards one lists before
 * it, the Rejections in the order the lists are read. A declaration sits at its name, else at the
 * first list that holds it, an export last: the Endpoints in order, each one's own list before
 * the Guards it attaches, a Guard's list before the Guards it lists, depth first, then the Guards
 * a Definitions Package exports, in member order, then its exported Rejections.
 */
export function referencesOf(sources: Sources): References {
  const { ownMembers, endpoints } = sources;
  const attached = endpoints.flatMap(({ endpoint }) => attachedGuardsOf(endpoint));
  const exported = ownMembers === undefined ? [] : memberGuardsOf(ownMembers);
  const reached = reachedGuardsOf([...attached, ...exported]);
  const { places, listed } = readLists(sources, reached);
  return {
    guards: reached.map((guard) => locatedGuardOf(guard, places)),
    rejections: locatedRejectionsOf(listed),
  };
}

function locatedGuardOf(guard: Guard, places: ReadonlyMap<Guard, Place>): LocatedGuard {
  const at = places.get(guard);
  if (at === undefined) {
    throw new Error('A Guard a Root reaches is attached or exported: a bug.');
  }
  return { at, guard };
}

/** A Rejection and the place that lists it: an export of a Definitions Package, or a list of a Guard or an Endpoint. */
type Listed = { readonly rejection: unknown; readonly held: Place };

/** What reading a Root's lists in order finds: where each Guard sits, and the Rejections listed. */
type Lists = { readonly places: Map<Guard, Place>; readonly listed: Listed[] };

type GuardMember = Extract<Member, { readonly kind: 'guard' }>;

function readLists({ ownMembers, endpoints }: Sources, reached: readonly Guard[]): Lists {
  const lists: Lists = { places: new Map(), listed: [] };
  for (const { at, endpoint } of endpoints) {
    lists.listed.push(...listedIn(at, endpoint.rejections));
    for (const [index, attachment] of listOf(endpoint.guards).entries()) {
      const guard = attachedGuardOf(attachment);
      if (guard !== undefined) {
        visit(lists, guard, holdingAt(at, 'guards', index));
      }
    }
  }
  const members = ownMembers ?? [];
  for (const { name, value } of exportedGuardsInOrder(members, reached)) {
    visit(lists, value, placeOf({ kind: 'export', name }, value));
  }
  lists.listed.push(...members.flatMap(exportedRejectionOf));
  return lists;
}

/**
 * The exported Guards in member order, a Guard with no name that another Guard lists left to that
 * Guard's list, which places it. Those still unplaced come last.
 */
function exportedGuardsInOrder(
  members: Members,
  reached: readonly Guard[],
): readonly GuardMember[] {
  const listed = new Set(reached.flatMap((guard) => listOf(guard.guards).filter(isGuard)));
  const exported = members.filter(isGuardMember);
  const readFirst = exported.filter(
    ({ value }) => typeof value.name === 'string' || !listed.has(value),
  );
  return [...readFirst, ...exported];
}

function isGuardMember(member: Member): member is GuardMember {
  return member.kind === 'guard';
}

/** Places a Guard at its name, else at the list that holds it, then reads its own lists. */
function visit(lists: Lists, guard: Guard, held: Place): void {
  if (lists.places.has(guard)) {
    return;
  }
  const name = guard.name;
  const at = placedBy(typeof name === 'string' ? { kind: 'guard', name } : undefined, held, guard);
  lists.places.set(guard, at);
  lists.listed.push(...listedIn(at, guard.rejections));
  for (const [index, listed] of listOf<unknown>(guard.guards).entries()) {
    if (isGuard(listed)) {
      visit(lists, listed, holdingAt(at, 'guards', index));
    }
  }
}

/** The place of an item of a list a declaration holds, by the field of the list and the position. */
function holdingAt(holder: Place, field: string, index: number): Place {
  return inside(holder, fieldStep(field), indexStep(index));
}

/** A declaration at its own site when its name is a string, else at the place that holds it. */
function placedBy(site: Site | undefined, held: Place, declaration: unknown): Place {
  return site === undefined ? { ...held, declaration } : placeOf(site, declaration);
}

/** Each listed Rejection once: at its code when that is a string, else at the first list. */
function locatedRejectionsOf(listed: readonly Listed[]): readonly LocatedRejection[] {
  const seen = new Set<unknown>();
  const located: LocatedRejection[] = [];
  for (const { rejection, held } of listed) {
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
