import { $ZodType } from 'zod/v4/core';
import type { Path, SchemaNode } from '../walker/nodes.ts';
import type { WalkedSchemas } from '../walker/walk.ts';
import type { LocatedSchema } from '../walker/walked.ts';
import type {
  Declarations,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
} from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { entriesOf, isPlainObject, partOf, textOf } from './written.ts';

/** A slot of a declaration that holds a schema, as the Snapshot names it. */
export type Part =
  | 'input.params'
  | 'input.query'
  | 'input.headers'
  | 'input.body'
  | 'success.headers'
  | 'success.body'
  | 'demands.headers'
  | 'demands.query'
  | 'context'
  | 'qualifier'
  | 'body'
  | 'schema';

/**
 * A schema slot: where it sits, the declaration that owns it and which part it is; a Rejection body
 * declared again for a code already written is `compared` with the first and not written itself.
 * The owner is the declaration itself, since two declarations may sit at one location; a shared
 * schema of a Definitions Package owns its own slot.
 */
export type Slot = {
  readonly at: Path;
  readonly owner: object;
  readonly part: Part;
  readonly value: unknown;
  readonly role: 'snapshot' | 'compared';
};

/** A slot that holds a zod schema, so the walk can be given it. */
export type SchemaSlot = Slot & { readonly value: $ZodType };

/** A slot whose schema walked to a node. */
export type WalkedSlot = Slot & { readonly node: SchemaNode };

/** A schema's node and where it sits in the root, as the walk returned it. */
export type LocatedNode = { readonly at: Path; readonly node: SchemaNode };

/** Every slot of a root that holds a schema, and the slots a cast filled with no schema. */
export type SchemaSlots = {
  readonly slots: readonly SchemaSlot[];
  readonly failures: readonly DeclarationFailure[];
};

/** The walked nodes of a root, by the declaration that owns them and the part, with their `defs`. */
export type Nodes = {
  readonly slots: readonly WalkedSlot[];
  readonly nodeOf: (owner: object, part: Part) => SchemaNode | undefined;
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/** Where a part of a declaration sits: the one place that spells a schema's location. */
export function slotAt(owner: Path, part: Exclude<Part, 'schema'>): Path {
  return [...owner, ...part.split('.')];
}

/** Every slot of a root that holds a value, in declaration order, so the walk sees each once. */
export function schemaSlotsOf(declarations: Declarations): SchemaSlots {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
    ...rejectionSlots(declarations.rejections),
    ...sharedSlots(declarations),
  ].filter(isFilled);
  const failures = slots
    .filter((slot) => !holdsSchema(slot))
    .map((slot) =>
      failure(slot.at, 'not-a-schema', `${textOf(slot.at.at(-1))} is not a zod schema`),
    );
  return { slots: slots.filter(holdsSchema), failures };
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
  const nodesByOwner = new Map<object, Map<Part, SchemaNode>>();
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
  const nodeOf = (owner: object, part: Part) => nodesByOwner.get(owner)?.get(part);
  return { slots: walkedSlots, nodeOf, defs: walked.defs };
}

function endpointSlots({ at, endpoint }: LocatedEndpoint): readonly Slot[] {
  const input = partOf<'params' | 'query' | 'headers' | 'body'>(endpoint.input);
  const success = partOf<'headers' | 'body'>(endpoint.success);
  const owned = { at, owner: endpoint };
  return [
    slot(owned, 'input.params', input.params),
    slot(owned, 'input.query', input.query),
    slot(owned, 'input.headers', input.headers),
    slot(owned, 'input.body', input.body),
    slot(owned, 'success.headers', success.headers),
    slot(owned, 'success.body', success.body),
  ];
}

function guardSlots({ at, guard }: LocatedGuard): readonly Slot[] {
  const demands = partOf<'headers' | 'query'>(guard.demands);
  const owned = { at, owner: guard };
  return [
    slot(owned, 'demands.headers', demands.headers),
    slot(owned, 'demands.query', demands.query),
    slot(owned, 'context', guard.context),
    slot(owned, 'qualifier', guard.qualifier),
  ];
}

/** One body per code is written, the first declaration's; every other is compared with it. */
function rejectionSlots(rejections: readonly LocatedRejection[]): readonly Slot[] {
  const written = new Set<string>();
  const slots: Slot[] = [];
  for (const { at, rejection } of rejections) {
    const code = textOf(rejection.code);
    const role = written.has(code) ? 'compared' : 'snapshot';
    written.add(code);
    slots.push({ ...slot({ at, owner: rejection }, 'body', rejection.body), role });
  }
  return slots;
}

/** A shared schema sits under `schemas` by name and owns its slot, being no declaration's part. */
function sharedSlots({ root }: Declarations): readonly Slot[] {
  if (root.kind !== 'definitions') {
    return [];
  }
  return entriesOf(root.schemas).map(([name, value]) => ({
    at: ['schemas', name],
    owner: isPlainObject(value) ? value : { name },
    part: 'schema' as const,
    value,
    role: 'snapshot' as const,
  }));
}

function slot(
  { at, owner }: { readonly at: Path; readonly owner: object },
  part: Exclude<Part, 'schema'>,
  value: unknown,
): Slot {
  return { at: slotAt(at, part), owner, part, value, role: 'snapshot' };
}

function isFilled(slot: Slot): boolean {
  return slot.value !== undefined;
}

/**
 * A zod schema, from zod, `zod/mini` or any copy: zod's own `instanceof` reads `_zod.traits`,
 * which a hand-built `_zod` object does not carry, so an impostor never reaches the walker.
 */
function holdsSchema(slot: Slot): slot is SchemaSlot {
  return slot.value instanceof $ZodType;
}
