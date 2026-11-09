import type { SchemaNode } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';

/** What a node, or the outline of one, holds of its type and bounds. */
type BoundedNode = {
  readonly type?: SchemaNode['type'] | undefined;
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
  readonly exclusiveMax?: number;
  readonly multipleOf?: number;
};

/** A bound as a node holds it: its value, and whether the value itself is excluded. */
type Bound = { readonly value: number; readonly exclusive: boolean };

/**
 * Why a node's own constraints admit no value, judged by its finite bounds alone, or `undefined`:
 * the rule the walker applies to what it writes and the decoder to what it reads.
 */
export function emptyConstraintOf(node: BoundedNode): Refused | undefined {
  const type: SchemaNode['type'] | undefined = node.type;
  switch (type) {
    case 'number':
      return numberRefusalOf(node);
    case 'string':
    case 'array':
      return lengthRefusalOf(node);
    case 'boolean':
    case 'enum':
    case 'object':
    case 'record':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
    case undefined:
      return undefined;
  }
}

function numberRefusalOf(node: BoundedNode): Refused | undefined {
  if (node.multipleOf !== undefined && node.multipleOf <= 0) {
    return refused.nonPositiveMultipleOf;
  }
  const lower = [boundOf(node.min, false), boundOf(node.exclusiveMin, true)].filter(isBound);
  const upper = [boundOf(node.max, false), boundOf(node.exclusiveMax, true)].filter(isBound);
  const crosses = lower.some((low) => upper.some((high) => isCrossed(low, high)));
  return crosses ? refused.crossedBounds : undefined;
}

function lengthRefusalOf(node: BoundedNode): Refused | undefined {
  const lengths = [node.min, node.max].filter(isFiniteBound);
  if (!lengths.every(isLength)) {
    return refused.lengthBound;
  }
  const lower = boundOf(node.min, false);
  const upper = boundOf(node.max, false);
  if (lower === undefined || upper === undefined) {
    return undefined;
  }
  return isCrossed(lower, upper) ? refused.crossedBounds : undefined;
}

/** Whether no value lies between a lower and an upper bound. */
function isCrossed(lower: Bound, upper: Bound): boolean {
  if (lower.value === upper.value) {
    return lower.exclusive || upper.exclusive;
  }
  return lower.value > upper.value;
}

function boundOf(value: number | undefined, exclusive: boolean): Bound | undefined {
  return isFiniteBound(value) ? { value, exclusive } : undefined;
}

function isBound(bound: Bound | undefined): bound is Bound {
  return bound !== undefined;
}

function isFiniteBound(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function isLength(length: number): boolean {
  return Number.isInteger(length) && length >= 0;
}
