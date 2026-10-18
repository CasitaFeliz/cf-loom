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
 * The owner is the declaration itself, since two declarations may sit at one location.
 */
export type Slot = {
  readonly at: Path;
  readonly owner: object;
  readonly part: Part;
  readonly value: unknown;
  readonly role: 'snapshot' | 'compared';
};

/** A slot whose schema walked to a node. */
export type WalkedSlot = Slot & { readonly node: SchemaNode };

/** A schema's node and where it sits in the root, as the walk returned it. */
export type LocatedNode = { readonly at: Path; readonly node: SchemaNode };

/** Every slot of a root that holds a schema, and the slots a cast filled with no schema. */
export type SchemaSlots = {
  readonly slots: readonly Slot[];
  readonly failures: readonly DeclarationFailure[];
};

/** The walked nodes of a root, by the declaration that owns them and the part, with their `defs`. */
export type Nodes = {
  readonly slots: readonly WalkedSlot[];
  readonly nodeOf: (owner: object, part: Part) => SchemaNode | undefined;
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

/** Where a part of a declaration sits: the one place that spells a schema's location. */
export function slotAt(owner: Path, part: Part): Path {
  return part === 'schema' ? owner : [...owner, ...part.split('.')];
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
      failure(slot.at, 'not-a-schema', `${String(slot.at.at(-1))} is not a zod schema`),
    );
  return { slots: slots.filter(holdsSchema), failures };
}

/** The schemas to walk, one per slot, in slot order. */
export function locatedSchemasOf(slots: readonly Slot[]): readonly LocatedSchema[] {
  return slots.filter(holdsSchema).map(({ at, value }) => ({ at, schema: value }));
}

/** The walked nodes by owner and part, zipped with the slots the walk was given, in order. */
export function nodesOf(slots: readonly Slot[], walked: WalkedSchemas): Nodes {
  const walkedSlots: WalkedSlot[] = [];
  for (const [index, slot] of slots.entries()) {
    const location = walked.located[index];
    if (location?.walked.kind === 'walked') {
      walkedSlots.push({ ...slot, node: location.walked.value });
    }
  }
  const nodeOf = (owner: object, part: Part) =>
    walkedSlots.find((slot) => slot.owner === owner && slot.part === part)?.node;
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
    const code = String(rejection.code);
    const role = written.has(code) ? 'compared' : 'snapshot';
    written.add(code);
    slots.push({ ...slot({ at, owner: rejection }, 'body', rejection.body), role });
  }
  return slots;
}

function sharedSlots({ root }: Declarations): readonly Slot[] {
  if (root.kind !== 'definitions') {
    return [];
  }
  return Object.entries(partOf<string>(root.schemas)).map(([name, value]) =>
    slot({ at: ['schemas', name], owner: root }, 'schema', value),
  );
}

function slot(
  { at, owner }: { readonly at: Path; readonly owner: object },
  part: Part,
  value: unknown,
): Slot {
  return { at: slotAt(at, part), owner, part, value, role: 'snapshot' };
}

/** A part a declaration may leave out is empty; what a cast put there that is no object is too. */
function partOf<Key extends string>(part: unknown): Partial<Readonly<Record<Key, unknown>>> {
  return typeof part === 'object' && part !== null ? (part as Record<Key, unknown>) : {};
}

function isFilled(slot: Slot): boolean {
  return slot.value !== undefined;
}

function holdsSchema(slot: Slot): slot is Slot & { readonly value: LocatedSchema['schema'] } {
  return typeof slot.value === 'object' && slot.value !== null && '_zod' in slot.value;
}
