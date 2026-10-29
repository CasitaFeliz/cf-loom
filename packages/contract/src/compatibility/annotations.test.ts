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

const annotations = ['description', 'examples', 'origin'];

function shapeTextOf(node: Annotated): string {
  return JSON.stringify(node, (key, value) => (annotations.includes(key) ? undefined : value));
}

/** One annotation edit on a copy of a walked node: add, drop or move a description or examples. */
function editedOf(node: SchemaNode, next: () => number): SchemaNode | undefined {
  const copy = structuredClone(node);
  const nodes = nodesWithin(copy);
  const pick = <Value>(values: readonly Value[]) =>
    values[Math.floor(next() * values.length)] as Value | undefined;
  const roll = next();
  if (roll < 0.2) {
    const target = pick(nodes);
    if (target === undefined) return undefined;
    target['description'] = pick(['x', 'y']);
    return copy;
  }
  if (roll < 0.35) {
    const target = pick(nodes.filter((held) => held['description'] !== undefined));
    if (target === undefined) return undefined;
    delete target['description'];
    return copy;
  }
  const annotation = roll < 0.85 ? 'description' : 'examples';
  const source = pick(nodes.filter((held) => held[annotation] !== undefined));
  const targets = nodes.filter(
    (held) => held !== source && source !== undefined && shapeTextOf(held) === shapeTextOf(source),
  );
  const target = pick(targets);
  if (source === undefined || target === undefined) return undefined;
  target[annotation] = source[annotation];
  delete source[annotation];
  return copy;
}

describe('compatibilityReportOf, an annotation edit at any depth', () => {
  test('is reported exactly when the bytes change, only as Neutral, and keeps the Snapshot decodable', {
    timeout: 60_000,
  }, () => {
    const next = seededNext(328);
    const { schemaOf } = randomSchemas(next);
    const schemas = Array.from({ length: 4000 }, () =>
      next() < 0.5 ? schemaOf(3) : equalLeavesOf(next),
    );
    const pairs = schemas.flatMap((schema) => {
      const walked = walkedOf(schema);
      const edited = walked === undefined ? undefined : editedOf(walked, next);
      return walked === undefined || edited === undefined ? [] : [{ walked, edited }];
    });

    const outcomes = pairs.map(({ walked, edited }) => {
      const baseline = publishedSnapshotOf(
        undefined,
        ordersAnswering(walked),
        publishedAt('1.0.0'),
      );
      const proposed = ordersAnswering(edited);
      const isByteChange = hashedTextOf(ordersAnswering(walked)) !== hashedTextOf(proposed);
      const republished = publishedSnapshotOf(baseline, proposed, publishedAt('1.0.1'));
      const decoded = decodeSnapshot(canonicalTextOf(republished)).kind;
      try {
        const { changes } = compatibilityReportOf(baseline, proposed);
        const kinds = changes.map((change) =>
          'shape' in change.difference ? `${change.difference.shape.kind} ${change.class}` : '',
        );
        return { isByteChange, isReported: changes.length > 0, kinds, decoded };
      } catch (e) {
        return { isByteChange, thrown: String(e), decoded };
      }
    });

    const wrong = outcomes.filter(
      (outcome) =>
        !('isReported' in outcome) ||
        outcome.isReported !== outcome.isByteChange ||
        outcome.kinds.some((kind) => kind !== 'annotation-changed neutral') ||
        outcome.decoded !== 'decoded',
    );
    expect(outcomes.filter(({ isByteChange }) => isByteChange).length).toBeGreaterThan(500);
    expect(wrong).toEqual([]);
  });
});
