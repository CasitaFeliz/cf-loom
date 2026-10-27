import type { Field } from '../walker/index.ts';
import { fieldStep, type Step } from '../walker/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type Finding, found, inside, type NodePairOf } from './findings.ts';

/** How two objects differ: each field, in code point order, added, removed, made required or optional, and its schema. */
export function objectFindingsOf({ baseline, proposed }: NodePairOf<'object'>): readonly Finding[] {
  return counterpartsOf(baseline.fields, proposed.fields).flatMap(fieldFindingsOf);
}

function fieldFindingsOf(field: Counterpart<Field>): readonly Finding[] {
  const steps = [fieldStep(field.key)];
  switch (field.kind) {
    case 'added':
      return [found({ kind: 'field-added', required: field.proposed.required }, steps)];
    case 'removed':
      return [found({ kind: 'field-removed' }, steps)];
    case 'kept':
      return [
        ...requirednessFindingsOf(field.baseline, field.proposed, steps),
        inside(field.baseline.schema, field.proposed.schema, steps),
      ];
  }
}

function requirednessFindingsOf(
  baseline: Field,
  proposed: Field,
  steps: readonly Step[],
): readonly Finding[] {
  if (baseline.required === proposed.required) {
    return [];
  }
  const kind = proposed.required ? 'field-made-required' : 'field-made-optional';
  return [found({ kind }, steps)];
}
