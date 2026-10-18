import type { Path, SchemaNode } from '../walker/nodes.ts';
import type { LocatedSchema } from '../walker/walked.ts';
import type {
  Declarations,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
} from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A schema's node and where it sits in the root, as the walk returned it. */
export type LocatedNode = { readonly at: Path; readonly node: SchemaNode };

/** Every schema a root declares, by location, and the slots a cast filled with no schema. */
export type SchemaSlots = {
  readonly located: readonly LocatedSchema[];
  readonly failures: readonly DeclarationFailure[];
};

/**
 * The walked nodes of a root, looked up by where the schema sits, with the `defs` they share;
 * two declarations of one Rejection code sit at one location, so a location may hold several.
 */
export type Nodes = {
  readonly nodeAt: (at: Path) => SchemaNode | undefined;
  readonly nodesAt: (at: Path) => readonly SchemaNode[];
  readonly defs: Readonly<Record<string, SchemaNode>>;
};

type Slot = { readonly at: Path; readonly value: unknown };

/** Every slot of a root that holds a schema, in declaration order, so the walk sees each once. */
export function schemaSlotsOf(declarations: Declarations): SchemaSlots {
  const slots = [
    ...declarations.endpoints.flatMap(endpointSlots),
    ...declarations.guards.flatMap(guardSlots),
    ...declarations.rejections.flatMap(rejectionSlots),
    ...sharedSlots(declarations),
  ];
  const filled = slots.filter(isFilled);
  const located = filled.filter(holdsSchema).map(({ at, value }) => ({ at, schema: value }));
  const failures = filled
    .filter((slot) => !holdsSchema(slot))
    .map((slot) => failure(slot.at, 'schema', `${String(slot.at.at(-1))} is not a zod schema`));
  return { located, failures };
}

/** The walked nodes by location, so a rule on schemas finds the node of a declaration. */
export function nodesOf(nodes: readonly LocatedNode[], defs: Nodes['defs']): Nodes {
  const nodesByLocation = new Map<string, SchemaNode[]>();
  for (const { at, node } of nodes) {
    const location = JSON.stringify(at);
    nodesByLocation.set(location, [...(nodesByLocation.get(location) ?? []), node]);
  }
  const nodesAt = (at: Path) => nodesByLocation.get(JSON.stringify(at)) ?? [];
  return { nodeAt: (at) => nodesAt(at)[0], nodesAt, defs };
}

function endpointSlots({ at, endpoint }: LocatedEndpoint): readonly Slot[] {
  const input = partOf<'params' | 'query' | 'headers' | 'body'>(endpoint.input);
  const success = partOf<'headers' | 'body'>(endpoint.success);
  return [
    { at: [...at, 'input', 'params'], value: input.params },
    { at: [...at, 'input', 'query'], value: input.query },
    { at: [...at, 'input', 'headers'], value: input.headers },
    { at: [...at, 'input', 'body'], value: input.body },
    { at: [...at, 'success', 'headers'], value: success.headers },
    { at: [...at, 'success', 'body'], value: success.body },
  ];
}

function guardSlots({ at, guard }: LocatedGuard): readonly Slot[] {
  const demands = partOf<'headers' | 'query'>(guard.demands);
  return [
    { at: [...at, 'demands', 'headers'], value: demands.headers },
    { at: [...at, 'demands', 'query'], value: demands.query },
    { at: [...at, 'context'], value: guard.context },
    { at: [...at, 'qualifier'], value: guard.qualifier },
  ];
}

function rejectionSlots({ at, rejection }: LocatedRejection): readonly Slot[] {
  return [{ at: [...at, 'body'], value: rejection.body }];
}

function sharedSlots({ root }: Declarations): readonly Slot[] {
  if (root.kind !== 'definitions') {
    return [];
  }
  return Object.entries(partOf<string>(root.schemas)).map(([name, value]) => ({
    at: ['schemas', name],
    value,
  }));
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
