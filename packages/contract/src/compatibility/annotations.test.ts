import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { randomSchemas, seededNext } from '../../test/random-schemas.ts';
import { publishedAt } from '../../test/snapshots.ts';
import {
  canonicalTextOf,
  compatibilityReportOf,
  decodeSnapshot,
  hashedTextOf,
  publishedSnapshotOf,
  type SchemaNode,
  type ServiceSnapshot,
  walkSchemas,
} from '../internal/index.ts';

const examples = new URL('../../../../examples/', import.meta.url);
const committed: ServiceSnapshot = JSON.parse(
  readFileSync(new URL('orders-service/contract.snapshot.json', examples), 'utf8'),
);
const identity = 'POST /orders';

/** The orders example with a walked node as one Endpoint's Success body. */
function ordersAnswering(body: SchemaNode): ServiceSnapshot {
  const endpoint = committed.endpoints[identity];
  if (endpoint === undefined) {
    throw new Error(`The example has no ${identity}`);
  }
  const answering = { ...endpoint, success: { ...endpoint.success, body } };
  return { ...committed, endpoints: { ...committed.endpoints, [identity]: answering } };
}

function walkedOf(schema: z.ZodType): SchemaNode | undefined {
  const at = { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: [] } as const;
  const walk = walkSchemas([{ at, schema }], () => undefined);
  const [located] = walk.located;
  const isPlain = located?.walked.kind === 'walked' && Object.keys(walk.defs).length === 0;
  return isPlain && located?.walked.kind === 'walked' ? located.walked.value : undefined;
}

/** Tuples, unions and arrays of one leaf, so two nodes of one shape are common. */
function equalLeavesOf(next: () => number): z.ZodType {
  const leaves = [z.string(), z.number(), z.string().min(1), z.boolean()];
  const leaf = leaves[Math.floor(next() * leaves.length)] ?? z.string();
  const composites = [
    (inner: z.ZodType) => z.tuple([inner, inner]),
    (inner: z.ZodType) => z.union([inner, inner]),
    (inner: z.ZodType) => z.array(inner),
    (inner: z.ZodType) => z.tuple([z.array(inner), inner]),
  ];
  let schema: z.ZodType = leaf;
  const depth = 1 + Math.floor(next() * 3);
  for (let level = 0; level < depth; level++) {
    schema = composites[Math.floor(next() * composites.length)]?.(schema) ?? schema;
  }
  return schema;
}

type Annotated = Record<string, unknown>;

/** Every schema node a walked node holds, itself first, a record's key left out. */
function nodesWithin(root: SchemaNode): readonly Annotated[] {
  const found: Annotated[] = [];
  const pending: unknown[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const held = node as Annotated;
    found.push(held);
    const fields = Object.values((held['fields'] ?? {}) as Record<string, { schema: unknown }>);
    const variants = Object.values((held['variants'] ?? {}) as Record<string, unknown>);
    const listed = [held['items'], held['options']].flat().filter((child) => child !== undefined);
    const single = [held['value'], held['rest']].filter((child) => child !== undefined);
    pending.push(...fields.map(({ schema }) => schema), ...variants, ...listed, ...single);
  }
  return found;
}

/** The values an edit draws for each annotation, which is also the list of annotations. */
const annotationValues: Record<string, readonly unknown[]> = {
  description: ['x', 'y'],
  examples: [['x'], ['y']],
  origin: ['local', '@org/definitions@1.0.0#money'],
};
const annotations = Object.keys(annotationValues);

function shapeTextOf(node: Annotated): string {
  return JSON.stringify(node, (key, value) => (annotations.includes(key) ? undefined : value));
}

function pickFrom<Value>(values: readonly Value[], next: () => number): Value | undefined {
  return values[Math.floor(next() * values.length)];
}

/** A copy of a walked node with an origin on some of its nodes, as a shared schema's uses have. */
function withOrigins(node: SchemaNode, next: () => number): SchemaNode {
  const copy = structuredClone(node);
  for (const held of nodesWithin(copy)) {
    if (next() < 0.3) {
      held['origin'] = pickFrom(annotationValues['origin'] ?? [], next);
    }
  }
  return copy;
}

/** One annotation edit on a copy of a walked node: add, drop or move a description, examples or origin. */
function editedOf(node: SchemaNode, next: () => number): SchemaNode | undefined {
  const copy = structuredClone(node);
  const nodes = nodesWithin(copy);
  const annotation = pickFrom(annotations, next) ?? 'description';
  const roll = next();
  if (roll < 0.2) {
    const target = pickFrom(nodes, next);
    if (target === undefined) {
      return undefined;
    }
    target[annotation] = pickFrom(annotationValues[annotation] ?? [], next);
    return copy;
  }
  const holders = nodes.filter((held) => held[annotation] !== undefined);
  const source = pickFrom(holders, next);
  if (source === undefined) {
    return undefined;
  }
  if (roll < 0.35) {
    delete source[annotation];
    return copy;
  }
  const sameShape = nodes.filter(
    (held) => held !== source && shapeTextOf(held) === shapeTextOf(source),
  );
  const target = pickFrom(sameShape, next);
  if (target === undefined) {
    return undefined;
  }
  target[annotation] = source[annotation];
  delete source[annotation];
  return copy;
}

type Edited = { readonly walked: SchemaNode; readonly edited: SchemaNode };

/** Walked nodes, some with annotations, each beside a copy with one annotation added, dropped or moved. */
function editedPairsOf(): readonly Edited[] {
  const next = seededNext(328);
  const { schemaOf } = randomSchemas(next);
  const schemas = Array.from({ length: 4000 }, () =>
    next() < 0.5 ? schemaOf(3) : equalLeavesOf(next),
  );
  return schemas.flatMap((schema) => {
    const plain = walkedOf(schema);
    const walked = plain === undefined ? undefined : withOrigins(plain, next);
    const edited = walked === undefined ? undefined : editedOf(walked, next);
    return walked === undefined || edited === undefined ? [] : [{ walked, edited }];
  });
}

type Outcome = {
  readonly isByteChange: boolean;
  readonly reported: readonly string[] | { readonly thrown: string };
  readonly decoded: string;
};

function changesBytes({ walked, edited }: Edited): boolean {
  return hashedTextOf(ordersAnswering(walked)) !== hashedTextOf(ordersAnswering(edited));
}

/** What the Compatibility Check and a republish make of one edit. */
function outcomeOf(pair: Edited): Outcome {
  const { walked, edited } = pair;
  const baseline = publishedSnapshotOf(undefined, ordersAnswering(walked), publishedAt('1.0.0'));
  const proposed = ordersAnswering(edited);
  const isByteChange = changesBytes(pair);
  const republished = publishedSnapshotOf(baseline, proposed, publishedAt('1.0.1'));
  const decoded = decodeSnapshot(canonicalTextOf(republished)).kind;
  try {
    const { changes } = compatibilityReportOf(baseline, proposed);
    const reported = changes.map((change) =>
      'shape' in change.difference ? `${change.difference.shape.kind} ${change.class}` : '',
    );
    return { isByteChange, reported, decoded };
  } catch (e) {
    return { isByteChange, reported: { thrown: String(e) }, decoded };
  }
}

function isWrong({ isByteChange, reported, decoded }: Outcome): boolean {
  if (!Array.isArray(reported)) {
    return true;
  }
  const isNeutralOnly = reported.every((kind) => kind === 'annotation-changed neutral');
  return reported.length > 0 !== isByteChange || !isNeutralOnly || decoded !== 'decoded';
}

describe('compatibilityReportOf, an annotation edit at any depth', () => {
  test('is drawn in volume: edits that change the bytes', () => {
    const changing = editedPairsOf().filter(changesBytes);

    expect(changing.length).toBeGreaterThan(500);
  });

  test('is reported exactly when the bytes change, only as Neutral, and keeps the Snapshot decodable', () => {
    const wrong = editedPairsOf().map(outcomeOf).filter(isWrong);

    expect(wrong).toEqual([]);
  });
});
