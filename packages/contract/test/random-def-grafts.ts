import type {
  Defs,
  Field,
  ObjectNode,
  SchemaNode,
  ServiceSnapshot,
} from '../src/internal/index.ts';
import { namesReachedBy } from './graft-defs.ts';
import { anEndpointOf, aServiceOf, graftedIdentity } from './graft-fixtures.ts';
import type { Next } from './random-draft.ts';
import { graftDrawOf } from './random-grafts.ts';
import { seededNext } from './random-schemas.ts';

/**
 * A Service of several Endpoints over one graph of defs, whose next version removes fields only
 * inside the defs, and edits some others in ways that put no field back. Each Endpoint's Input
 * body keeps some of the fields the draw's body holds, so the Endpoints reach different defs; the
 * Service holds only the defs the bodies reach, so each def a field was removed from or edited is
 * one an Endpoint reaches. Now and then no field is removed at all.
 */
export type DefGraftDraw = {
  readonly baselineDefs: Defs;
  readonly proposedDefs: Defs;
  /** The Input bodies of the Endpoints, one each, in the order of their identities. */
  readonly bodies: readonly ObjectNode[];
  /** The defs a field was removed from. */
  readonly landed: readonly string[];
  /** The defs that were edited without removing a field. */
  readonly edited: readonly string[];
  /** What the draw holds: the steps down to an object a field was removed from, and the nodes inside a removed field. */
  readonly kinds: ReadonlySet<string>;
};

/** The identity of an Endpoint of a draw's Service, `PUT /e0`, `PUT /e1`…, by its index. */
export function identityOf(index: number): string {
  return `${graftedIdentity}${index}`;
}

/** Whether the draw's edits to a def put no field back: a field added that is optional, or a description set. */
function editedOf(def: SchemaNode, next: Next): SchemaNode {
  if (def.type === 'object' && next() < 0.5) {
    return {
      ...def,
      fields: { ...def.fields, edited: { required: false, schema: { type: 'string' } } },
    };
  }
  return { ...def, description: 'edited' };
}

function bodyFieldsOf(body: ObjectNode): readonly (readonly [string, Field])[] {
  return Object.entries(body.fields);
}

/** Some of the fields, at least one, each kept with chance one half. */
function subsetOf(fields: readonly (readonly [string, Field])[], next: Next): ObjectNode {
  const kept = fields.filter(() => next() < 0.5);
  const chosen = kept.length > 0 ? kept : [fields[Math.floor(next() * fields.length)]];
  return {
    type: 'object',
    fields: Object.fromEntries(chosen.filter((entry) => entry !== undefined)),
  };
}

/**
 * The draw a seed gives: a `graftDrawOf` draw with the Baseline's body replaced by the proposed
 * one, so the removals land only inside defs, some defs edited besides, and 2 to 5 Endpoints.
 */
export function defGraftDrawOf(seed: number): DefGraftDraw {
  const draw = graftDrawOf(seed);
  const next = seededNext(seed * 3911 + 101);
  const proposedBody = draw.proposed.endpoints[graftedIdentity]?.input.body as ObjectNode;
  const dropped = [...draw.kinds]
    .filter((kind) => kind.startsWith('dropped: '))
    .map((kind) => kind.slice('dropped: '.length));
  const held = Object.entries(draw.baseline.defs).filter(([name]) => !dropped.includes(name));
  const isUntouched = next() < 0.12;
  const baselineDefs: Defs = Object.fromEntries(
    isUntouched ? Object.entries(draw.proposed.defs) : held,
  );
  const isEdited = next() < 0.5;
  const edited = Object.keys(baselineDefs).filter(() => isEdited && next() < 0.3);
  const proposedDefs: Defs = Object.fromEntries(
    Object.entries(draw.proposed.defs).map(([name, def]) => [
      name,
      edited.includes(name) ? editedOf(def, next) : def,
    ]),
  );
  const count = 2 + Math.floor(next() * 4);
  const fields = bodyFieldsOf(proposedBody);
  const bodies = Array.from({ length: count }, () => subsetOf(fields, next));
  return reachedOnly({
    baselineDefs,
    proposedDefs,
    bodies,
    landed: isUntouched ? [] : draw.landed,
    edited,
    kinds: draw.kinds,
  });
}

/** The draw with only the defs its bodies reach, on each side, and the removals and edits made in them. */
function reachedOnly(draw: DefGraftDraw): DefGraftDraw {
  const baselineReached = namesReachedBy(draw.bodies, draw.baselineDefs);
  const proposedReached = namesReachedBy(draw.bodies, draw.proposedDefs);
  const only = (defs: Defs, reached: ReadonlySet<string>): Defs =>
    Object.fromEntries(Object.entries(defs).filter(([name]) => reached.has(name)));
  return {
    ...draw,
    baselineDefs: only(draw.baselineDefs, baselineReached),
    proposedDefs: only(draw.proposedDefs, proposedReached),
    landed: draw.landed.filter((name) => baselineReached.has(name)),
    edited: draw.edited.filter((name) => proposedReached.has(name)),
  };
}

/** The draw's Service as the Baseline holds it and as the next version declares it, the bodies put under the identities given, in order. */
export function servicesOf(
  draw: DefGraftDraw,
  identities: readonly string[],
): { readonly baseline: ServiceSnapshot; readonly proposed: ServiceSnapshot } {
  const endpoints = Object.fromEntries(
    draw.bodies.map((body, index) => [identities[index] as string, anEndpointOf(body)]),
  );
  return {
    baseline: aServiceOf(endpoints, draw.baselineDefs),
    proposed: aServiceOf(endpoints, draw.proposedDefs),
  };
}

/** Whether an Endpoint's body reaches, through `ref`s, a def a field was removed from. */
export function reachesLanded(draw: DefGraftDraw, body: ObjectNode): boolean {
  const reached = namesReachedBy([body], draw.baselineDefs);
  return draw.landed.some((owner) => reached.has(owner));
}

/** The identities in another order, a seeded shuffle. */
export function shuffledIdentities(identities: readonly string[], next: Next): readonly string[] {
  const shuffled = [...identities];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other] as string, shuffled[index] as string];
  }
  return shuffled;
}
