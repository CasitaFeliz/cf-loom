import type { Path } from './nodes.ts';

/** The parts of an Endpoint, a Guard or a Rejection that a difference sits under. */
export type PartName =
  | 'input'
  | 'success'
  | 'demands'
  | 'params'
  | 'query'
  | 'headers'
  | 'body'
  | 'context'
  | 'qualifier';

/**
 * One step from a site to where a failure or a difference is, as the author wrote it: a part or
 * a field of a declaration or of an object schema, a position in a list or in a tuple, a union's
 * option, a variant of a discriminated union.
 */
export type Step =
  | { readonly kind: 'part'; readonly name: PartName }
  | { readonly kind: 'field'; readonly name: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'option'; readonly index: number }
  | { readonly kind: 'items' }
  | { readonly kind: 'rest' }
  | { readonly kind: 'key' }
  | { readonly kind: 'value' }
  | { readonly kind: 'variant'; readonly discriminator: string; readonly value: string };

/** The steps down the named parts of an Endpoint, a Guard or a Rejection, in order. */
export function partsOf(...names: readonly PartName[]): readonly Step[] {
  return names.map((name) => ({ kind: 'part', name }));
}

/** The step into a field of an object or of a declaration, whose name is its key. */
export function fieldStep(name: string): Step {
  return { kind: 'field', name };
}

/** The step into a position of a list or of a tuple, counted from zero. */
export function indexStep(index: number): Step {
  return { kind: 'index', index };
}

/** The step into a plain union's option, counted from zero in declared order. */
export function optionStep(index: number): Step {
  return { kind: 'option', index };
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
    case 'index':
      return ['items', step.index];
    case 'option':
      return ['options', step.index];
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

/** What a name or a text may be on a line without quotes. */
const plainToken = /^[\w@/$-]+$/;

/** A text as it stands on a line: itself when plain, else as JSON, so it reads as one token. */
export function tokenOf(text: string): string {
  return plainToken.test(text) ? text : JSON.stringify(text);
}

/**
 * Steps in the author's terms: `success.body.orders[].lines[].kind<type="a">.x`, where `[]` is an
 * array's items, `[<i>]` a position of a tuple or a list, `[...]` a tuple's rest, `<|<i>>` a
 * union's option, `{}` a record's value, `{key}` its key and `<discriminator=value>` a variant;
 * none when there are no steps.
 */
export function authorPathOf(steps: readonly Step[]): string | null {
  if (steps.length === 0) {
    return null;
  }
  return steps.map((step, position) => textOf(step, position === 0)).join('');
}

/** Steps as they continue a path that already has a step: `.lines[].kind`; nothing for none. */
export function pathTailOf(steps: readonly Step[]): string {
  return steps.map((step) => textOf(step, false)).join('');
}

function textOf(step: Step, isFirst: boolean): string {
  switch (step.kind) {
    case 'part':
      return named(step.name, isFirst);
    case 'field':
      return named(tokenOf(step.name), isFirst);
    case 'index':
      return `[${step.index}]`;
    case 'option':
      return `<|${step.index}>`;
    case 'items':
      return '[]';
    case 'rest':
      return '[...]';
    case 'key':
      return '{key}';
    case 'value':
      return '{}';
    case 'variant':
      return `<${tokenOf(step.discriminator)}=${step.value}>`;
  }
}

function named(name: string, isFirst: boolean): string {
  return isFirst ? name : `.${name}`;
}
