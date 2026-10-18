import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import type * as core from 'zod/v4/core';
import {
  type Checked,
  checkedSlots,
  fieldOf,
  type Issue,
  type Slot,
  withIssues,
} from './checked.ts';

type Parts = Readonly<Record<string, unknown>>;

const inputParts = ['params', 'query', 'headers', 'body'] as const;
const demandParts = ['headers', 'query'] as const;

/** An Endpoint's Input, each declared part parsed with its schema; an undeclared part is not read. */
export function checkedInput(endpoint: Endpoint, input: unknown): Checked<Parts> {
  const declared = endpoint.input ?? {};
  const parts = inputParts.map((name) => ({
    name,
    part: `input.${name}` as const,
    schema: declared[name],
  }));
  return checkedSlots(parts.filter(isDeclared).map((part) => slotOf(part, input)));
}

/** What a Guard demands, each declared part parsed with its schema. */
export function checkedDemands(guard: Guard, demands: unknown): Checked<Parts> {
  const declared = guard.demands ?? {};
  const parts = demandParts.map((name) => ({
    name,
    part: `demands.${name}` as const,
    schema: declared[name],
  }));
  return checkedSlots(parts.filter(isDeclared).map((part) => slotOf(part, demands)));
}

/**
 * A Context, one key per Guard that provides one, each parsed with that Guard's `context` schema;
 * any other key is unrecognized.
 */
export function checkedContext(guards: readonly Guard[], context: unknown): Checked<Parts> {
  const providers = guards.filter(isContextProvider);
  const slots = providers.map(
    (guard): Slot => ({
      key: guard.name,
      part: 'context',
      at: [guard.name],
      schema: guard.context,
      value: fieldOf(context, guard.name),
    }),
  );
  const provided = providers.map((guard) => guard.name);
  return withIssues(checkedSlots(slots), unrecognizedIssues(context, provided));
}

/** A Guard's Qualifier, parsed with its `qualifier` schema; nothing for a Guard without one. */
export function checkedQualifier(guard: Guard, qualifier: unknown): Checked<unknown> {
  if (guard.qualifier === undefined) {
    return { kind: 'value', value: undefined };
  }
  const slot: Slot = {
    key: 'qualifier',
    part: 'qualifier',
    at: [],
    schema: guard.qualifier,
    value: qualifier,
  };
  const checked = checkedSlots([slot]);
  return checked.kind === 'issues' ? checked : { kind: 'value', value: checked.value['qualifier'] };
}

type ContextProvider = Guard & { readonly context: core.$ZodType };

function isContextProvider(guard: Guard): guard is ContextProvider {
  return guard.context !== undefined;
}

/** A part an Element may declare, with its schema when it does. */
type DeclarablePart = {
  readonly name: string;
  readonly part: Slot['part'];
  readonly schema: core.$ZodType | undefined;
};

function isDeclared<Declarable extends DeclarablePart>(
  part: Declarable,
): part is Declarable & { readonly schema: core.$ZodType } {
  return part.schema !== undefined;
}

function slotOf(
  { name, part, schema }: DeclarablePart & { readonly schema: core.$ZodType },
  given: unknown,
): Slot {
  return { key: name, part, at: [], schema, value: fieldOf(given, name) };
}

function unrecognizedIssues(context: unknown, provided: readonly string[]): readonly Issue[] {
  const keys = typeof context === 'object' && context !== null ? Object.keys(context) : [];
  return keys
    .filter((key) => !provided.includes(key))
    .map((key) => ({
      part: 'context',
      path: [key],
      code: 'unrecognized_key',
      message: 'Unrecognized key',
    }));
}
