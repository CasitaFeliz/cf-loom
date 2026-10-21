import {
  canonicalJson,
  type EnumNode,
  type JsonPrimitive,
  type SchemaNode,
} from '../walker/index.ts';
import { counterpartsOf } from './counterparts.ts';
import {
  type Finding,
  found,
  type NodePair,
  shapeKeyBesidesNullability,
  typeChanged,
} from './findings.ts';

type BaseType = 'string' | 'number' | 'boolean';

/** Whether a schema is an enum or a literal, which is compared as an enum. */
export function isEnumLike(node: SchemaNode): boolean {
  return node.type === 'enum' || node.type === 'literal';
}

/**
 * How two schemas differ when either is an enum or a literal, which compares as a closed enum of
 * its one value: its openness and values, or widened to and narrowed from a base type with no
 * constraint.
 */
export function enumFindingsOf(pair: NodePair): readonly Finding[] {
  const baseline = enumOf(pair.baseline);
  const proposed = enumOf(pair.proposed);
  if (baseline !== undefined && proposed !== undefined) {
    return [...opennessFindingsOf(baseline, proposed), ...valueFindingsOf(baseline, proposed)];
  }
  const to = widenedTo(pair);
  if (to !== undefined) {
    return [found({ kind: 'enum-widened', to })];
  }
  const from = narrowedFrom(pair);
  return from === undefined ? [typeChanged(pair)] : [found({ kind: 'enum-narrowed', from })];
}

function enumOf(node: SchemaNode): EnumNode | undefined {
  if (node.type === 'enum') {
    return node;
  }
  return node.type === 'literal' ? { type: 'enum', values: [node.value], open: false } : undefined;
}

function opennessFindingsOf(baseline: EnumNode, proposed: EnumNode): readonly Finding[] {
  if (baseline.open === proposed.open) {
    return [];
  }
  return [found({ kind: proposed.open ? 'enum-opened' : 'enum-closed' })];
}

/** Each value added or removed, in code point order of its JSON, judged by the Baseline's openness. */
function valueFindingsOf(baseline: EnumNode, proposed: EnumNode): readonly Finding[] {
  const openness = baseline.open ? 'open' : 'closed';
  const findings: Finding[] = [];
  for (const value of counterpartsOf(valuesByJson(baseline), valuesByJson(proposed))) {
    switch (value.kind) {
      case 'added':
        findings.push(found({ kind: 'value-added', value: value.proposed, enum: openness }));
        break;
      case 'removed':
        findings.push(found({ kind: 'value-removed', value: value.baseline }));
        break;
      case 'kept':
        break;
    }
  }
  return findings;
}

/** An enum's values by their JSON, so `true` and `"true"` are different values. */
function valuesByJson(node: EnumNode): Readonly<Record<string, JsonPrimitive>> {
  return Object.fromEntries(node.values.map((value) => [canonicalJson(value), value]));
}

function widenedTo(pair: NodePair): BaseType | undefined {
  const values = enumOf(pair.baseline);
  const base = unconstrainedTypeOf(pair.proposed);
  return values !== undefined && commonTypeOf(values) === base ? base : undefined;
}

function narrowedFrom(pair: NodePair): BaseType | undefined {
  const values = enumOf(pair.proposed);
  const base = unconstrainedTypeOf(pair.baseline);
  return values !== undefined && commonTypeOf(values) === base ? base : undefined;
}

/**
 * The type of a string, number or boolean with no constraint, which every value of its type meets.
 * A constrained one is left out because proving that each value meets it is not attempted, so
 * widening to it or narrowing from it is a type change.
 */
function unconstrainedTypeOf(node: SchemaNode): BaseType | undefined {
  const isUnconstrained = shapeKeyBesidesNullability(node) === canonicalJson({ type: node.type });
  return isBaseType(node.type) && isUnconstrained ? node.type : undefined;
}

function isBaseType(type: SchemaNode['type']): type is BaseType {
  return type === 'string' || type === 'number' || type === 'boolean';
}

/** The one JSON type every value of an enum has, if they share one. */
function commonTypeOf(node: EnumNode): BaseType | undefined {
  const types = new Set(node.values.map(typeOfValue));
  const [only] = types;
  return types.size === 1 ? only : undefined;
}

function typeOfValue(value: JsonPrimitive): BaseType {
  if (typeof value === 'string') {
    return 'string';
  }
  return typeof value === 'number' ? 'number' : 'boolean';
}
