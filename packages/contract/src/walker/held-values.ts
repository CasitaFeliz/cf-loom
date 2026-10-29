import type * as core from 'zod/v4/core';
import { defTypes, type WalkedDef } from './def-types.ts';
import { innerOfOneLazy } from './lazy.ts';
import {
  fieldStep,
  indexStep,
  itemsStep,
  keyStep,
  optionStep,
  restStep,
  type Step,
  valueStep,
} from './steps.ts';

/** A value a walked def holds where `defTypes` lists a schema, and the step it sits at, if any. */
export type Held = {
  readonly value: unknown;
  readonly step: Step | undefined;
  readonly isField: boolean;
};

/** The step a child under each key `defTypes` lists sits at, by its position under that key. */
const stepsByKey: Readonly<Record<string, (position: number) => Step | undefined>> = {
  keyType: () => keyStep,
  valueType: () => valueStep,
  element: () => itemsStep,
  items: indexStep,
  rest: () => restStep,
  options: optionStep,
  left: () => indexStep(0),
  right: () => indexStep(1),
  getter: () => undefined,
  innerType: () => undefined,
};

/**
 * The values a walked def holds, as its `defTypes` row lists them: an object's fields, the schemas
 * under each listed key, and the schema a lazy's getter returns. A tuple without `rest` holds none.
 */
export function heldValuesOf(schema: core.$ZodType, def: WalkedDef): readonly Held[] {
  const treatment: { readonly walks: readonly string[] } | { readonly fields: string } =
    defTypes[def.type];
  if ('fields' in treatment) {
    const shape = Object.entries((def as core.$ZodObjectDef).shape);
    return shape.map(([name, value]) => ({ value, step: fieldStep(name), isField: true }));
  }
  const keyed = def as unknown as Readonly<Record<string, unknown>>;
  return treatment.walks.flatMap((key) =>
    heldUnder(key, key === 'getter' ? innerOfOneLazy(schema as core.$ZodLazy) : keyed[key]),
  );
}

/** The values under one key of a def, each at its step: a list's by position, a `rest` of `null` none. */
function heldUnder(key: string, value: unknown): readonly Held[] {
  if (key === 'rest' && value === null) {
    return [];
  }
  const stepAt = stepsByKey[key] ?? (() => undefined);
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  return values.map((item, position) => ({ value: item, step: stepAt(position), isField: false }));
}
