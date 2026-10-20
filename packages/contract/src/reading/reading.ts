import type { Endpoint, Guard } from '../declarations/index.ts';
import { parsedPartsOf } from '../issues/index.ts';
import { type InputIssue, malformedBodyIssueOf, type ReceivedBody } from '../wire/index.ts';
import { attachmentsOf, demandParts, inputParts, schemaOf } from '../written/index.ts';

/**
 * What ends a reading before its Input is read: a Guard that did not admit, or a body the reader
 * would not read.
 */
export type Stop<Answer> = { readonly kind: 'stopped'; readonly answer: Answer };

/**
 * A request as its Provider reads it: its Input parsed, unknown keys stripped, the Issues it
 * answers instead, or what stopped it first.
 */
export type Reading<Answer = never> =
  | { readonly kind: 'input'; readonly input: Readonly<Record<string, unknown>> }
  | { readonly kind: 'invalid'; readonly issues: readonly InputIssue[] }
  | Stop<Answer>;

/** Where a reading takes a request's parts from, each only once the reading reaches it. */
export type ReadingSource<Answer = never> = {
  /** The values a party's text parts carry, by field: an Endpoint's Input or a Guard's demands. */
  readonly textOf: (party: Endpoint | Guard) => Readonly<Record<string, unknown>>;
  /** The body, asked for only when the Endpoint declares one and every Guard admitted it. */
  readonly body: () => Promise<ReceivedBody | Stop<Answer>>;
  /**
   * The run of the Endpoint's Attachment at `index` on its Guard's parsed demands, before the next
   * Guard's are read; without it, every Guard admits.
   */
  readonly admit?: (
    index: number,
    demands: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly kind: 'admitted' } | Stop<Answer>>;
};

/** What a step before the Input leaves: the reading goes on with what it gives, or it ends. */
type Step<Answer, Given> =
  | { readonly kind: 'read'; readonly given: Given }
  | Exclude<Reading<Answer>, { readonly kind: 'input' }>;

/**
 * A request read in the one order every Provider reads it, so `serve`, the client and the fakes
 * answer alike.
 */
export async function readingOf<Answer = never>(
  endpoint: Endpoint,
  source: ReadingSource<Answer>,
): Promise<Reading<Answer>> {
  const admitted = await admittedOf(endpoint, source);
  if (admitted.kind !== 'read') {
    return admitted;
  }
  const body = await bodyOf(endpoint, source);
  if (body.kind !== 'read') {
    return body;
  }
  const given = { ...source.textOf(endpoint), ...body.given };
  const input = parsedPartsOf(inputParts, (part) => schemaOf(endpoint, part), given);
  if (input.kind === 'issues') {
    return { kind: 'invalid', issues: input.issues };
  }
  return { kind: 'input', input: input.value };
}

/**
 * Each Guard's demands in Attachment order, then its run once they are met; the first that fails
 * answers alone.
 */
async function admittedOf<Answer>(
  endpoint: Endpoint,
  source: ReadingSource<Answer>,
): Promise<Step<Answer, undefined>> {
  for (const [index, { guard }] of attachmentsOf(endpoint).entries()) {
    const schemaAt = (part: (typeof demandParts)[number]) => schemaOf(guard, part);
    const demands = parsedPartsOf(demandParts, schemaAt, source.textOf(guard));
    if (demands.kind === 'issues') {
      return { kind: 'invalid', issues: demands.issues };
    }
    const run = await source.admit?.(index, demands.value);
    if (run?.kind === 'stopped') {
      return run;
    }
  }
  return { kind: 'read', given: undefined };
}

/** The body under its field, when the Endpoint declares one; one not read answers alone. */
async function bodyOf<Answer>(
  endpoint: Endpoint,
  source: ReadingSource<Answer>,
): Promise<Step<Answer, { readonly body?: unknown }>> {
  if (schemaOf(endpoint, 'input.body') === undefined) {
    return { kind: 'read', given: {} };
  }
  const body = await source.body();
  switch (body.kind) {
    case 'stopped':
      return body;
    case 'value':
      return { kind: 'read', given: { body: body.value } };
    case 'malformed':
    case 'unreadable':
      return { kind: 'invalid', issues: [malformedBodyIssueOf(body.message)] };
  }
}
