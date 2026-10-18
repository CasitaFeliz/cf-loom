import { $ZodType } from 'zod/v4/core';
import type { LocatedSchema, Path, SchemaNode, WalkedSchemas } from '../walker/index.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { LocatedCode, LocatedEndpoint, LocatedGuard } from './located.ts';
import { entriesOf, partOf, textOf } from './written.ts';

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

/** The parts that travel as text and are objects of their fields in a valid root. */
export const objectParts = [
  'input.params',
  'input.query',
  'input.headers',
  'success.headers',
  'demands.headers',
  'demands.query',
] as const satisfies readonly Part[];

/** A part a valid root declares as an object of its fields. */
export type ObjectPart = (typeof objectParts)[number];

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

/** Where a part of a declaration sits: the one place that spells a schema's location. */
export function slotAt(owner: Path, part: Exclude<Part, 'schema'>): Path {
  return [...owner, ...part.split('.')];
}

/**
 * Whether a value is a zod schema, by zod's own `instanceof`: it reads the traits in `_zod`, which
 * zod, `zod/mini` and any copy of either set and a hand-built `_zod` object lacks, so an impostor
 * never reaches the walker, which reads `_zod.def`.
 */
export function isSchema(value: unknown): value is $ZodType {
  return value instanceof $ZodType;
}

/** Every slot of a root that holds a value, in declaration order, so the walk sees each once. */
export function schemaSlotsOf(declarations: Declarations): SchemaSlots {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
    ...declarations.codes.flatMap(codeSlots),
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
