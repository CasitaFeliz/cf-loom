import type { $ZodType } from 'zod/v4/core';
import {
  failuresOf,
  isSchema,
  isWhole,
  type JudgedDefs,
  type LocatedSchema,
  type NotAllowed,
  type ObjectNode,
  type Outline,
  outlineOf,
  type Place,
  placeNameOf,
  placeOf,
  refusalsIn,
  type SchemaNode,
  type WalkedLocation,
  type WalkedSchemas,
} from '../walker/index.ts';
import {
  type Declarations,
  endpointParts,
  guardParts,
  isObjectPart,
  type LocatedCode,
  type LocatedEndpoint,
  type LocatedGuard,
  type Member,
  type ObjectPart,
  type Part,
  slotAt,
  writtenAt,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/**
 * A schema slot: where it sits, what owns it and which part it is. The owner is the declaration
 * itself, since two declarations may sit at one location; a shared schema of a Definitions Package
 * owns its own slot.
 */
export type Slot = {
  readonly at: Place;
  readonly owner: unknown;
  readonly part: Part;
  readonly value: unknown;
};

/** A slot that holds a zod schema, so the walk can be given it. */
export type SchemaSlot = Slot & { readonly value: $ZodType };

/** A slot whose schema walked to a node, or failed keeping the outline it was building. */
export type OutlinedSlot = Slot & { readonly node: Outline };

/** Every slot of a Root that holds a schema, and the slots a cast filled with no schema. */
export type SchemaSlots = {
  readonly slots: readonly SchemaSlot[];
  readonly failures: readonly DeclarationFailure[];
};

/**
 * The outlines of a Root's schemas, a node walked whole being its own, by the declaration that owns
 * them and the part, with the `defs` the Snapshot holds and the defs the rules over defs judge.
 */
export type Nodes = {
  readonly slots: readonly OutlinedSlot[];
  readonly nodeOf: (owner: unknown, part: Part) => Outline | undefined;
  readonly defs: Readonly<Record<string, SchemaNode>>;
  readonly judgedDefs: JudgedDefs;
};

/** The slots of a Root's Endpoints, Guards and Rejections that travel as text, in declaration order. */
export function textSlotsOf(declarations: Declarations): readonly Slot[] {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
    ...declarations.codes.flatMap(codeSlots),
  ];
  return slots.filter((slot) => isObjectPart(slot.part));
}

/** Every slot of a Root that holds a value, in declaration order, so the walk sees each once. */
export function schemaSlotsOf(declarations: Declarations): SchemaSlots {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
    ...declarations.codes.flatMap(codeSlots),
    ...sharedSlots(declarations),
    ...messageSlots(declarations),
  ];
  return schemaSlotsAmong(slots);
}

/** The slots among the given that hold a schema, and a failure for each filled with something else. */
export function schemaSlotsAmong(slots: readonly Slot[]): SchemaSlots {
  const filled = slots.filter(isFilled);
  const failures = filled
    .filter((slot) => !holdsSchema(slot))
    .map((slot) => failure(slot.at, 'not-a-schema', `${placeNameOf(slot.at)} is not a zod schema`));
  return { slots: filled.filter(holdsSchema), failures };
}

/** The schemas to walk, one per slot, in slot order. */
export function locatedSchemasOf(slots: readonly SchemaSlot[]): readonly LocatedSchema[] {
  return slots.map(({ at, value }) => ({ at, schema: value }));
}

/** The outlines by owner and part, zipped with the slots the walk was given, in order. */
export function nodesOf(slots: readonly SchemaSlot[], walked: WalkedSchemas): Nodes {
  if (walked.located.length !== slots.length) {
    throw new Error('The walk returned a result for a number of schemas other than given: a bug.');
  }
  const outlinedSlots: OutlinedSlot[] = [];
  const outlinesByOwner = new Map<unknown, Map<Part, Outline>>();
  for (const [index, slot] of slots.entries()) {
    const location = walked.located[index];
    if (location === undefined) {
      continue;
    }
    const node = outlineOf(location.walked);
    outlinedSlots.push({ ...slot, node });
    const parts = outlinesByOwner.get(slot.owner) ?? new Map<Part, Outline>();
    if (!parts.has(slot.part)) {
      parts.set(slot.part, node);
    }
    outlinesByOwner.set(slot.owner, parts);
  }
  const nodeOf = (owner: unknown, part: Part) => outlinesByOwner.get(owner)?.get(part);
  return { slots: outlinedSlots, nodeOf, defs: walked.defs, judgedDefs: walked.judgedDefs };
}

/**
 * The node of a declaration's part, if it declares that part: an object for a part that travels as
 * text, since the validation refuses any other there.
 */
export type NodeLookup = {
  (declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  (declaration: unknown, part: Part): SchemaNode | undefined;
};

/** Finds the nodes walked whole by declaration and part, a text part's typed as the object it is. */
export function nodeLookupOf(nodes: Nodes): NodeLookup {
  function nodeOf(declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined {
    const node = nodes.nodeOf(declaration, part);
    const isObject = node?.type === 'object';
    if (!isWhole(node) || (isObjectPart(part) && !isObject)) {
      return undefined;
    }
    return node;
  }
  return nodeOf;
}

/** Every refusal the walk made at the locations, each once, in the order it first meets them. */
export function refusalsAt(locations: readonly WalkedLocation[]): readonly NotAllowed[] {
  return refusalsIn(failuresOf(locations.map(({ walked }) => walked)));
}

function endpointSlots({ at, endpoint }: LocatedEndpoint): readonly Slot[] {
  const owned = { at, owner: endpoint };
  return endpointParts.map((part) => slot(owned, part, writtenAt(endpoint, part)));
}

function guardSlots({ at, guard }: LocatedGuard): readonly Slot[] {
  const owned = { at, owner: guard };
  return guardParts.map((part) => slot(owned, part, writtenAt(guard, part)));
}

/** Each declaration of a code owns its headers' and its body's slots; a valid Root has one declaration per code. */
function codeSlots({ rejections }: LocatedCode): readonly Slot[] {
  return rejections.flatMap(({ at, rejection }) => [
    slot({ at, owner: rejection }, 'headers', rejection.headers),
    slot({ at, owner: rejection }, 'body', rejection.body),
  ]);
}

/** A shared schema sits under `exports` by the name it is exported as and owns its slot, being no declaration's part. */
function sharedSlots({ ownMembers = [] }: Declarations): readonly Slot[] {
  return ownMembers.filter(isSchemaMember).map(({ name, value }) => ({
    at: placeOf({ kind: 'export', name }, value),
    owner: value,
    part: 'schema' as const,
    value,
  }));
}

/** A Message Version owns its body; a Provider's Event is its Contract Package's, recorded by identity only. */
function messageSlots({ events, commands }: Declarations): readonly Slot[] {
  return [
    ...events.map(({ at, event }) => slot({ at, owner: event }, 'body', event.body)),
    ...commands.map(({ at, command }) => slot({ at, owner: command }, 'body', command.body)),
  ];
}

function slot(
  { at, owner }: { readonly at: Place; readonly owner: unknown },
  part: Exclude<Part, 'schema'>,
  value: unknown,
): Slot {
  return { at: slotAt(at, part), owner, part, value };
}

function isFilled(slot: Slot): boolean {
  return slot.value !== undefined;
}

function holdsSchema(slot: Slot): slot is SchemaSlot {
  return isSchema(slot.value);
}

function isSchemaMember(member: Member): member is Extract<Member, { readonly kind: 'schema' }> {
  return member.kind === 'schema';
}
