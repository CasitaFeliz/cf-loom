import { authorPathOf, fieldStep, type Step, tokenOf } from './steps.ts';

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
 * kinds a Change is found at, each with its Visibility; the Root, a recursive def and a
 * Definitions Package are sites of failures only.
 */
export type Site =
  | { readonly kind: 'root' }
  | EndpointSite
  | MessageSite
  | CodeSite
  | NamedSite
  /** A recursive schema by its `.meta({ id })`, where a too-deep Snapshot value sits. */
  | { readonly kind: 'def'; readonly name: string }
  | { readonly kind: 'definitions'; readonly label: string };

/** The sites a Change is found at: every kind of site but the Root, a recursive def and a Definitions Package. */
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
    case 'definitions':
      return site.label;
  }
}

/** Where a failure sits on one line: its site, then its steps in the author's terms. */
export function siteLocationOf(site: Site, steps: readonly Step[]): string {
  const path = authorPathOf(steps);
  return path === null ? siteTextOf(site) : `${siteTextOf(site)} ${path}`;
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

/** The place of a declaration itself, at its site, with no steps. */
export function placeOf(site: Site, declaration: unknown): Place {
  return { site, declaration, steps: [] };
}

/** A place further inside the same declaration, down the steps. */
export function inside(place: Place, ...steps: readonly Step[]): Place {
  return { ...place, steps: [...place.steps, ...steps] };
}

/** A place down the fields of the same declaration, such as `visibility` or `success`, `status`. */
export function inFields(place: Place, ...names: readonly string[]): Place {
  return inside(place, ...names.map(fieldStep));
}
