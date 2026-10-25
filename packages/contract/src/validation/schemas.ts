import type { $ZodType } from 'zod/v4/core';
import type {
  LocatedSchema,
  NotAllowed,
  ObjectNode,
  Path,
  SchemaNode,
  WalkedLocation,
  WalkedSchemas,
} from '../walker/index.ts';
import {
  type Declarations,
  endpointParts,
  guardParts,
  isObjectPart,
  isSchema,
  type LocatedCode,
  type LocatedEndpoint,
  type LocatedGuard,
  type Member,
  type ObjectPart,
  type Part,
  slotAt,
  textOf,
  writtenAt,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/**
 * A schema slot: where it sits, what owns it and which part it is. The owner is the declaration
 * itself, since two declarations may sit at one location; a shared schema of a Definitions Package
 * owns its own slot.
 */
export type Slot = {
  readonly at: Path;
  readonly owner: unknown;
  readonly part: Part;
  readonly value: unknown;
};

/** A slot that holds a zod schema, so the walk can be given it. */
export type SchemaSlot = Slot & { readonly value: $ZodType };

/** A slot whose schema walked to a node. */
export type WalkedSlot = Slot & { readonly node: SchemaNode };

/** Every slot of a root that holds a schema, and the slots a cast filled with no schema. */
export type SchemaSlots = {
  readonly slots: readonly SchemaSlot[];
  readonly failures: readonly DeclarationFailure[];
};

/** The walked nodes of a root, by the declaration that owns them and the part, with their `defs`. */
export type Nodes = {
  readonly slots: readonly WalkedSlot[];
  readonly nodeOf: (owner: unknown, part: Part) => SchemaNode | undefined;
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/** The slots of a root's Endpoints and Guards that travel as text, in declaration order. */
export function textSlotsOf(declarations: Declarations): readonly Slot[] {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
  ];
  return slots.filter((slot) => isObjectPart(slot.part));
}

/** Every slot of a root that holds a value, in declaration order, so the walk sees each once. */
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
    .map((slot) =>
      failure(slot.at, 'not-a-schema', `${textOf(slot.at.at(-1))} is not a zod schema`),
    );
  return { slots: filled.filter(holdsSchema), failures };
}

/** The schemas to walk, one per slot, in slot order. */
export function locatedSchemasOf(slots: readonly SchemaSlot[]): readonly LocatedSchema[] {
  return slots.map(({ at, value }) => ({ at, schema: value }));
}

/** The walked nodes by owner and part, zipped with the slots the walk was given, in order. */
export function nodesOf(slots: readonly SchemaSlot[], walked: WalkedSchemas): Nodes {
  if (walked.located.length !== slots.length) {
    throw new Error('The walk returned a result for a number of schemas other than given: a bug.');
  }
  const walkedSlots: WalkedSlot[] = [];
  const nodesByOwner = new Map<unknown, Map<Part, SchemaNode>>();
  for (const [index, slot] of slots.entries()) {
    const location = walked.located[index];
    if (location?.walked.kind !== 'walked') {
      continue;
    }
    walkedSlots.push({ ...slot, node: location.walked.value });
    const parts = nodesByOwner.get(slot.owner) ?? new Map<Part, SchemaNode>();
    if (!parts.has(slot.part)) {
      parts.set(slot.part, location.walked.value);
    }
    nodesByOwner.set(slot.owner, parts);
  }
  const nodeOf = (owner: unknown, part: Part) => nodesByOwner.get(owner)?.get(part);
  return { slots: walkedSlots, nodeOf, defs: walked.defs };
}

/**
 * The node of a declaration's part, if it declares that part: an object for a part that travels as
 * text, since the validation refuses any other there.
 */
export type NodeLookup = {
  (declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  (declaration: unknown, part: Part): SchemaNode | undefined;
};

/** Finds walked nodes by declaration and part, a text part's typed as the object it is. */
export function nodeLookupOf(nodes: Nodes): NodeLookup {
  function nodeOf(declaration: unknown, part: ObjectPart): ObjectNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined;
  function nodeOf(declaration: unknown, part: Part): SchemaNode | undefined {
    const node = nodes.nodeOf(declaration, part);
    return isObjectPart(part) && node?.type !== 'object' ? undefined : node;
  }
  return nodeOf;
}

/** What the walk refused at a location; a cycle's failure comes back wherever the cycle is met. */
export function failuresAt(location: WalkedLocation): readonly NotAllowed[] {
  return location.walked.kind === 'not-allowed' ? location.walked.failures : [];
}

function endpointSlots({ at, endpoint }: LocatedEndpoint): readonly Slot[] {
  const owned = { at, owner: endpoint };
  return endpointParts.map((part) => slot(owned, part, writtenAt(endpoint, part)));
}

function guardSlots({ at, guard }: LocatedGuard): readonly Slot[] {
  const owned = { at, owner: guard };
  return guardParts.map((part) => slot(owned, part, writtenAt(guard, part)));
}

/** Each declaration of a code owns its body's slot; a valid root has one per code. */
function codeSlots({ rejections }: LocatedCode): readonly Slot[] {
  return rejections.map(({ at, rejection }) =>
    slot({ at, owner: rejection }, 'body', rejection.body),
  );
}

/** A shared schema sits under `exports` by the name it is exported as and owns its slot, being no declaration's part. */
function sharedSlots({ ownMembers = [] }: Declarations): readonly Slot[] {
  return ownMembers.filter(isSchemaMember).map(({ name, value }) => ({
    at: ['exports', name],
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
  { at, owner }: { readonly at: Path; readonly owner: unknown },
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
