import type { Path } from '../walker/index.ts';

/** The parts of an Endpoint, a Guard or a Rejection that a difference sits under. */
export type PartName = 'input' | 'success' | 'demands' | 'params' | 'query' | 'headers' | 'body';

/** One step from a site to where a difference is, as the author wrote the schema. */
export type Step =
  | { readonly kind: 'part'; readonly name: PartName }
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'items' }
  | { readonly kind: 'rest' }
  | { readonly kind: 'key' }
  | { readonly kind: 'value' }
  | { readonly kind: 'variant'; readonly discriminator: string; readonly value: string };

/** The steps down the named parts of an Endpoint, a Guard or a Rejection, in order. */
export function partsOf(...names: readonly PartName[]): readonly Step[] {
  return names.map((name) => ({ kind: 'part', name }));
}

/** The step into a field of an object, whose name is its key. */
export function fieldStep(name: string): Step {
  return { kind: 'field', name };
}

/** The step into a discriminated union's variant, whose value is the key the Snapshot holds it under. */
export function variantStep(discriminator: string, value: string): Step {
  return { kind: 'variant', discriminator, value };
}

/** The step into an array's items. */
export const itemsStep: Step = { kind: 'items' };

/** The step into a tuple's `rest`. */
export const restStep: Step = { kind: 'rest' };

/** The step into a record's key. */
export const keyStep: Step = { kind: 'key' };

/** The step into a record's value. */
export const valueStep: Step = { kind: 'value' };

/** The path a Snapshot spells for steps: `fields.<name>`, `items`, `variants.<value>`… */
export function snapshotPathOf(steps: readonly Step[]): Path {
  return steps.flatMap(snapshotSegmentsOf);
}

function snapshotSegmentsOf(step: Step): Path {
  switch (step.kind) {
    case 'part':
      return [step.name];
    case 'field':
      return ['fields', step.name];
    case 'items':
      return ['items'];
    case 'rest':
      return ['rest'];
    case 'key':
      return ['key'];
    case 'value':
      return ['value'];
    case 'variant':
      return ['variants', step.value];
  }
}
