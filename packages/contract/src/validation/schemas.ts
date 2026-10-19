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
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedCode, LocatedEndpoint, LocatedGuard } from './located.ts';
import {
  endpointParts,
  guardParts,
  isObjectPart,
  isSchema,
  type ObjectPart,
  type Part,
  slotAt,
  writtenAt,
} from './parts.ts';
import { entriesOf, textOf } from './written.ts';

/**
 * A schema slot: where it sits, what owns it and which part it is; a Rejection body declared
 * again for a code already written is `compared` with the first and not written itself. The owner
 * is the declaration itself, since two declarations may sit at one location; a shared schema of a
 * Definitions Package owns its own slot.
 */
export type Slot = {
  readonly at: Path;
  readonly owner: unknown;
  readonly part: Part;
  readonly value: unknown;
  readonly role: 'snapshot' | 'compared';
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

/** One body per code is written, the first declaration's; every other is compared with it. */
function codeSlots({ rejections: [first, ...others] }: LocatedCode): readonly Slot[] {
  return [
    slot({ at: first.at, owner: first.rejection }, 'body', first.rejection.body),
    ...others.map(({ at, rejection }) => ({
      ...slot({ at, owner: rejection }, 'body', rejection.body),
      role: 'compared' as const,
    })),
  ];
}

/** A shared schema sits under `schemas` by name and owns its slot, being no declaration's part. */
function sharedSlots({ root }: Declarations): readonly Slot[] {
  if (root.kind !== 'definitions') {
    return [];
  }
  return entriesOf(root.schemas).map(([name, value]) => ({
    at: ['schemas', name],
    owner: value,
    part: 'schema' as const,
    value,
    role: 'snapshot' as const,
  }));
}

function slot(
  { at, owner }: { readonly at: Path; readonly owner: unknown },
  part: Exclude<Part, 'schema'>,
  value: unknown,
): Slot {
  return { at: slotAt(at, part), owner, part, value, role: 'snapshot' };
}

function isFilled(slot: Slot): boolean {
  return slot.value !== undefined;
}

function holdsSchema(slot: Slot): slot is SchemaSlot {
  return isSchema(slot.value);
}
