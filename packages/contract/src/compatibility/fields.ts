import { type Field, isKeyedRecord, type ObjectNode, type Path } from '../walker/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type Finding, found, inside, type NodePairOf } from './findings.ts';

/**
 * How two objects differ: a change of mode is a different type, so no field is compared then;
 * otherwise each field, in code point order, added, removed, made required or optional, and its
 * schema.
 */
export function objectFindingsOf({ baseline, proposed }: NodePairOf<'object'>): readonly Finding[] {
  if (baseline.mode !== proposed.mode) {
    return [found({ kind: 'mode-changed', from: baseline.mode, to: proposed.mode })];
  }
  const fields = counterpartsOf(baseline.fields, proposed.fields);
  return fields.flatMap((field) => fieldFindingsOf(field, baseline));
}

function fieldFindingsOf(field: Counterpart<Field>, object: ObjectNode): readonly Finding[] {
  const steps = ['fields', field.key];
  switch (field.kind) {
    case 'added':
      return [found({ kind: 'field-added', required: field.proposed.required }, steps)];
    case 'removed':
      return [found(removalOf(object), steps)];
    case 'kept':
      return [
        ...requirednessFindingsOf(field.baseline, field.proposed, steps),
        inside(field.baseline.schema, field.proposed.schema, steps),
      ];
  }
}

/** A key gone from a record keyed by an enum or literal refuses it from then on. */
function removalOf(object: ObjectNode): { readonly kind: 'key-removed' | 'field-removed' } {
  return { kind: isKeyedRecord(object) ? 'key-removed' : 'field-removed' };
}

function requirednessFindingsOf(baseline: Field, proposed: Field, steps: Path): readonly Finding[] {
  if (baseline.required === proposed.required) {
    return [];
  }
  const kind = proposed.required ? 'field-made-required' : 'field-made-optional';
  return [found({ kind }, steps)];
}
