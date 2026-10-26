import { authorPathOf, fieldStep, pathTailOf, type Step, tokenOf } from './steps.ts';

/** An Endpoint by identity, with its name. */
type EndpointSite = { readonly kind: 'endpoint'; readonly identity: string; readonly name: string };

/** An Event or a Command by identity. */
type MessageSite = { readonly kind: 'event' | 'command'; readonly identity: string };

/** A Rejection by its code. */
type CodeSite = { readonly kind: 'code'; readonly code: string };

/** A declaration the Contract names, such as a Group or a Guard. */
type NamedSite = {
  readonly kind:
    | 'group'
    | 'standard-rejection'
    | 'guard'
    | 'subscription'
    | 'dependency'
    | 'export';
  readonly name: string;
};

/**
 * What a failure or a Change sits in, as the author declared it. The Check's `ChangeSite` is the
 * kinds a Change is found at, each with its Visibility; the Root and a recursive def are sites of
 * failures only.
 */
export type Site =
  | { readonly kind: 'root' }
  | EndpointSite
  | MessageSite
  | CodeSite
  | NamedSite
  /** A recursive schema by its `.meta({ id })`, where a too-deep Snapshot value sits. */
  | { readonly kind: 'def'; readonly name: string };

/** The sites a Change is found at: every kind of site but the Root and a recursive def. */
export type ChangedSite = EndpointSite | MessageSite | CodeSite | NamedSite;

/** A site as every line names it: `endpoints.GET /orders/{} (getOrder)`, `events.OrderCreated@2`, `(root)`. */
export function siteTextOf(site: Site): string {
  switch (site.kind) {
    case 'root':
      return '(root)';
    case 'endpoint':
      return `endpoints.${site.identity} (${tokenOf(site.name)})`;
    case 'event':
      return `events.${site.identity}`;
    case 'command':
      return `commands.${site.identity}`;
    case 'code':
      return `codes.${tokenOf(site.code)}`;
    case 'group':
      return `groups.${tokenOf(site.name)}`;
    case 'guard':
      return `guards.${tokenOf(site.name)}`;
    case 'subscription':
      return `subscriptions.${tokenOf(site.name)}`;
    case 'dependency':
      return `dependencies.${tokenOf(site.name)}`;
    case 'export':
      return `exports.${tokenOf(site.name)}`;
    case 'standard-rejection':
      return `standardRejections.${tokenOf(site.name)}`;
    case 'def':
      return `defs.${tokenOf(site.name)}`;
  }
}

/** Where a failure sits on one line: its site, then its steps in the author's terms. */
export function siteLocationOf(site: Site, steps: readonly Step[]): string {
  const path = authorPathOf(steps);
  return path === null ? siteTextOf(site) : `${siteTextOf(site)} ${path}`;
}

/** The text `siteLocationOf` gives a place `below` steps under another, from that one's text. */
export function locationBelowOf(text: string, place: Place, below: readonly Step[]): string {
  if (below.length === 0) {
    return text;
  }
  return place.steps.length === 0 ? siteLocationOf(place.site, below) : text + pathTailOf(below);
}

/**
 * Where something sits: the declaration it is in, that declaration's site and the steps from the
 * site, so a tool that knows the declaration's file can name it.
 */
export type Place = {
  readonly site: Site;
  /** The declaration the place sits in; none when the Snapshot, not a declaration, is judged. */
  readonly declaration: unknown;
  readonly steps: readonly Step[];
};

/** What a place is called in a sentence: the field it is at, else the name of its site. */
export function placeNameOf({ site, steps }: Place): string {
  const last = steps.at(-1);
  if (last?.kind === 'field' || last?.kind === 'part') {
    return last.name;
  }
  return 'name' in site ? site.name : siteTextOf(site);
}

/** The place of a declaration itself, at its site, with no steps. */
export function placeOf(site: Site, declaration: unknown): Place {
  return { site, declaration, steps: [] };
}

/** A place further inside the same declaration, down the steps. */
export function inside<Held extends Place>(place: Held, ...steps: readonly Step[]): Held {
  return { ...place, steps: [...place.steps, ...steps] };
}

/** A place down the fields of the same declaration, such as `visibility` or `success`, `status`. */
export function inFields<Held extends Place>(place: Held, ...names: readonly string[]): Held {
  return inside(place, ...names.map(fieldStep));
}

/** What the walk built or reported at `from`, as it stands when the walk enters the same schema at `to`. */
export function movedFrom<Held extends Place>(held: Held, from: Place, to: Place): Held {
  const below = held.steps.slice(from.steps.length);
  return { ...held, site: to.site, declaration: to.declaration, steps: [...to.steps, ...below] };
}
