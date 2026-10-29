import type { Endpoint, Guard } from '@cf-loom/contract';
import {
  contextProvidersOf,
  demandParts,
  inputParts,
  ownOf,
  parsedPartOf,
  parsedPartsOf,
  schemaOf,
} from '@cf-loom/contract/internal';
import { type Checked, checkedAll, type Issue, mapValue, withIssues } from './checked.ts';

/**
 * What a request carries beside its Input, for cancelling and tracing: its abort signal and its
 * headers as received, never validated and never Input.
 */
export type HandledRequest = { readonly signal: AbortSignal; readonly headers: Headers };

/** What one call of an EndpointHandler is given, before it is checked; its request and Resources are passed on unchecked. */
export type EndpointGiven = {
  readonly input: unknown;
  readonly context: unknown;
  readonly request: HandledRequest;
  readonly resources: unknown;
};

/** What one call of a GuardHandler is given, before it is checked; its request and Resources are passed on unchecked. */
export type GuardGiven = {
  readonly demands: unknown;
  readonly context: unknown;
  readonly qualifier: unknown;
  readonly request: HandledRequest;
  readonly resources: unknown;
};

/** Parsed values by the field a Handler reads them under. */
type ValuesByField = Readonly<Record<string, unknown>>;

/**
 * What `serve` gives one call of an EndpointHandler: its Input as the contract's reading parsed it,
 * and the Context `serve` built from its Guards' Admissions, which the run checks; the request and
 * the Resources passed on unchecked.
 */
export type EndpointRead = {
  readonly input: ValuesByField;
  readonly context: unknown;
  readonly request: HandledRequest;
  readonly resources: unknown;
};

/**
 * What `serve` gives one call of a GuardHandler: its demands as the contract's reading parsed them,
 * and the Context and Qualifier `serve` built, which the run checks; the request and the Resources
 * passed on unchecked.
 */
export type GuardRead = {
  readonly demands: ValuesByField;
  readonly context: unknown;
  readonly qualifier: unknown;
  readonly request: HandledRequest;
  readonly resources: unknown;
};

/** The Input and Context an EndpointHandler's implementation receives, checked. */
export type EndpointArguments = { readonly input: ValuesByField; readonly context: ValuesByField };

/** The demands, Context and Qualifier a GuardHandler's implementation receives, checked. */
export type GuardArguments = {
  readonly demands: ValuesByField;
  readonly context: ValuesByField;
  readonly qualifier: unknown;
};

/** The Input and Context of one call of an EndpointHandler, as its implementation receives them. */
export function checkedEndpointCall(
  endpoint: Endpoint,
  given: EndpointGiven,
): Checked<EndpointArguments> {
  const schemaAt = (part: (typeof inputParts)[number]) => schemaOf(endpoint, part);
  return checkedAll({
    input: parsedPartsOf(inputParts, schemaAt, given.input),
    context: checkedContext(endpoint, given.context),
  });
}

/** The Input and Context of one call `serve` read: the Input as its reading parsed it, the Context checked. */
export function readEndpointCall(
  endpoint: Endpoint,
  read: EndpointRead,
): Checked<EndpointArguments> {
  const context = checkedContext(endpoint, read.context);
  return mapValue(context, (checked) => ({ input: read.input, context: checked }));
}

/** The demands, Context and Qualifier of one call of a GuardHandler, as its implementation receives them. */
export function checkedGuardCall(guard: Guard, given: GuardGiven): Checked<GuardArguments> {
  const schemaAt = (part: (typeof demandParts)[number]) => schemaOf(guard, part);
  return checkedAll({
    demands: parsedPartsOf(demandParts, schemaAt, given.demands),
    context: checkedContext(guard, given.context),
    qualifier: checkedQualifier(guard, given.qualifier),
  });
}

/** The demands, Context and Qualifier of one call `serve` read: the demands as parsed, the rest checked. */
export function readGuardCall(guard: Guard, read: GuardRead): Checked<GuardArguments> {
  const checked = checkedAll({
    context: checkedContext(guard, read.context),
    qualifier: checkedQualifier(guard, read.qualifier),
  });
  return mapValue(checked, ({ context, qualifier }) => ({
    demands: read.demands,
    context,
    qualifier,
  }));
}

/** A Guard's Qualifier, parsed with the Guard's `qualifier` schema. */
function checkedQualifier(guard: Guard, qualifier: unknown): Checked<unknown> {
  return parsedPartOf('qualifier', schemaOf(guard, 'qualifier'), { value: qualifier });
}

/**
 * A Context, one key per Guard that provides one, each parsed with that Guard's `context` schema;
 * any other key is unrecognized.
 */
function checkedContext(receiving: Endpoint | Guard, context: unknown): Checked<ValuesByField> {
  const providers = contextProvidersOf(receiving);
  const checks = providers.map((guard) => {
    const given = { value: ownOf(context, guard.name), at: [guard.name] };
    return [guard.name, parsedPartOf('context', schemaOf(guard, 'context'), given)] as const;
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
