import { type Token, tokenOf } from '../lines/index.ts';
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

/**
 * The steps from a site to a place, as a place holds them: its last step and the chain of the
 * place it is inside, with how many steps they make, so a place one step further costs one step,
 * whatever its depth; none at the site itself.
 */
export type StepChain =
  | { readonly above: StepChain; readonly step: Step; readonly count: number }
  | undefined;

/** The chain continued down `more`, sharing the chain given. */
export function chainDown(chain: StepChain, more: readonly Step[]): StepChain {
  let down = chain;
  for (const step of more) {
    down = { above: down, step, count: (down?.count ?? 0) + 1 };
  }
  return down;
}

/** The steps from the site, in order, as a line or a record that names them reads them. */
export function stepListOf(chain: StepChain): readonly Step[] {
  const steps: Step[] = [];
  for (let link = chain; link !== undefined; link = link.above) {
    steps.push(link.step);
  }
  return steps.reverse();
}

/** The steps of `held` below `from`, a place it sits inside, in order: what a place moved elsewhere keeps. */
export function stepsBelow(held: StepChain, from: StepChain): readonly Step[] {
  const below: Step[] = [];
  for (let link = held; link !== undefined && link.count > (from?.count ?? 0); link = link.above) {
    below.push(link.step);
  }
  return below.reverse();
}

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

/**
 * Steps from a site, or, with a `def`, from the recursive schema of that id in `defs`; without the
 * `def` the same steps name another place.
 */
export type Anchored = { readonly at: readonly Step[]; readonly def?: string };

/** The path a Snapshot spells for anchored steps, `defs.<def>` first when they have a `def`. */
export function anchoredSnapshotPathOf({ at, def }: Anchored): Path {
  const below = snapshotPathOf(at);
  return def === undefined ? below : ['defs', def, ...below];
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

/** How a recursive schema is named on a line, as a failure's site or where a Change's path starts: `defs.<id>`. */
export function defTextOf(name: string): string {
  return `defs.${tokenOf(name)}`;
}

/**
 * Steps in the author's terms: `success.body.orders[].lines[].kind<type="a">.x`, where `[]` is an
 * array's items, `[<i>]` a position of a tuple or a list, `[...]` a tuple's rest, `<|<i>>` a
 * union's option, `{}` a record's value, `{key}` its key and `<discriminator=value>` a variant;
 * none when there are no steps.
 */
export function authorPathOf(steps: readonly Step[]): Token | null {
  if (steps.length === 0) {
    return null;
  }
  return steps.map((step, position) => textOf(step, position === 0)).join('') as Token;
}

/**
 * Anchored steps in the author's terms: those of `authorPathOf`, or, with a `def`, `defs.<id>`
 * then the steps below it (`defs.tree.children[]`), which is the whole path when there are none.
 */
export function anchoredAuthorPathOf({ at, def }: Anchored): string | null {
  return def === undefined ? authorPathOf(at) : defTextOf(def) + pathTailOf(at);
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
