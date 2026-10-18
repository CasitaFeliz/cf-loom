import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import {
  attachedGuardsOf,
  demandParts,
  fieldsOf,
  inputParts,
  schemaOf,
} from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';
import {
  type Checked,
  checkedAll,
  checkedPart,
  fieldOf,
  type Issue,
  withIssues,
} from './checked.ts';

/** What one call of an EndpointHandler is given, before it is checked. */
export type EndpointGiven = { readonly input: unknown; readonly context: unknown };

/** What one call of a GuardHandler is given, before it is checked. */
export type GuardGiven = {
  readonly demands: unknown;
  readonly context: unknown;
  readonly qualifier: unknown;
};

/** Parsed values by the field a Handler reads them under. */
type ValuesByField = Readonly<Record<string, unknown>>;

/** The Input and Context of one call of an EndpointHandler, as its implementation receives them. */
export function checkedEndpointCall(
  endpoint: Endpoint,
  given: EndpointGiven,
): Checked<{ readonly input: ValuesByField; readonly context: ValuesByField }> {
  const schemaAt = (part: (typeof inputParts)[number]) => schemaOf(endpoint, part);
  return checkedAll({
    input: checkedDeclaredParts(inputParts, schemaAt, given.input),
    context: checkedContext(attachedGuardsOf(endpoint), given.context),
  });
}

/** The demands, Context and Qualifier of one call of a GuardHandler, as its implementation receives them. */
export function checkedGuardCall(
  guard: Guard,
  given: GuardGiven,
): Checked<{
  readonly demands: ValuesByField;
  readonly context: ValuesByField;
  readonly qualifier: unknown;
}> {
  const schemaAt = (part: (typeof demandParts)[number]) => schemaOf(guard, part);
  return checkedAll({
    demands: checkedDeclaredParts(demandParts, schemaAt, given.demands),
    context: checkedContext(guard.guards ?? [], given.context),
    qualifier: checkedPart('qualifier', schemaOf(guard, 'qualifier'), { value: given.qualifier }),
  });
}

/** Each part that declares a schema, parsed under its field; a part declaring none is not read. */
function checkedDeclaredParts<
  CallPart extends (typeof inputParts)[number] | (typeof demandParts)[number],
>(
  parts: readonly CallPart[],
  schemaAt: (part: CallPart) => core.$ZodType | undefined,
  given: unknown,
): Checked<ValuesByField> {
  const declared = parts.filter((part) => schemaAt(part) !== undefined);
  const checks = declared.map((part) => {
    const field = fieldsOf(part)[1];
    const value = fieldOf(given, field);
    return [field, checkedPart(part, schemaAt(part), { value })] as const;
  });
  return checkedAll(Object.fromEntries(checks));
}

/**
 * A Context, one key per Guard that provides one, each parsed with that Guard's `context` schema;
 * any other key is unrecognized.
 */
function checkedContext(guards: readonly Guard[], context: unknown): Checked<ValuesByField> {
  const providers = guards.filter((guard) => schemaOf(guard, 'context') !== undefined);
  const checks = providers.map((guard) => {
    const given = { value: fieldOf(context, guard.name), at: [guard.name] };
    return [guard.name, checkedPart('context', schemaOf(guard, 'context'), given)] as const;
  });
  const provided = providers.map((guard) => guard.name);
  return withIssues(checkedAll(Object.fromEntries(checks)), unrecognizedIssues(context, provided));
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
