import type { Endpoint, Guard } from '@casitafeliz/loom-contract';
import {
  contextProvidersOf,
  demandParts,
  inputParts,
  parsedPartsOf,
  schemaOf,
} from '@casitafeliz/loom-contract/internal';
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
    input: parsedPartsOf(inputParts, schemaAt, given.input),
    context: checkedContext(endpoint, given.context),
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
    demands: parsedPartsOf(demandParts, schemaAt, given.demands),
    context: checkedContext(guard, given.context),
    qualifier: checkedPart('qualifier', schemaOf(guard, 'qualifier'), { value: given.qualifier }),
  });
}

/**
 * A Context, one key per Guard that provides one, each parsed with that Guard's `context` schema;
 * any other key is unrecognized.
 */
function checkedContext(receiving: Endpoint | Guard, context: unknown): Checked<ValuesByField> {
  const providers = contextProvidersOf(receiving);
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
