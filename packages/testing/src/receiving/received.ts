import {
  demandIssuesOf,
  type InputIssue,
  inputParts,
  malformedBodyIssueOf,
  parsedPartsOf,
  receivedBodyOf,
  schemaOf,
  type TextSource,
  textPartsOf,
} from '@casitafeliz/loom-contract/internal';
import type { ListedEndpoint } from '../provided/index.ts';

/** A request as the Provider reads it: its Input, parsed, or the Issues it answers instead. */
export type Received =
  | { readonly kind: 'valid'; readonly input: Readonly<Record<string, unknown>> }
  | { readonly kind: 'invalid'; readonly issues: readonly InputIssue[] };

/**
 * A request read as the Provider reads it: its Guards' demands first, the first that fails
 * answering alone; then its body, when the Endpoint declares one, a malformed one answering alone;
 * then its Input, parsed with the Endpoint's schemas.
 */
export async function receivedOf(
  listed: ListedEndpoint,
  request: Request,
  source: TextSource,
): Promise<Received> {
  const text = textPartsOf(listed.nodes, source);
  const demandIssues = demandIssuesOf(listed.endpoint, text);
  if (demandIssues.length > 0) {
    return { kind: 'invalid', issues: demandIssues };
  }
  const given: Given = listed.readsBody
    ? await withBodyOf(request, text)
    : { kind: 'given', given: text };
  if (given.kind === 'invalid') {
    return given;
  }
  const schemaAt = (part: (typeof inputParts)[number]) => schemaOf(listed.endpoint, part);
  const parsed = parsedPartsOf(inputParts, schemaAt, given.given);
  if (parsed.kind === 'issues') {
    return { kind: 'invalid', issues: parsed.issues };
  }
  return { kind: 'valid', input: parsed.value };
}

/** What a request gives its Input: its text parts, and its body read as JSON. */
type Given =
  | { readonly kind: 'given'; readonly given: Readonly<Record<string, unknown>> }
  | { readonly kind: 'invalid'; readonly issues: readonly InputIssue[] };

async function withBodyOf(
  request: Request,
  text: Readonly<Record<string, unknown>>,
): Promise<Given> {
  const body = await receivedBodyOf(request);
  switch (body.kind) {
    case 'value':
      return { kind: 'given', given: { ...text, body: body.value } };
    case 'malformed':
    case 'unreadable':
      return { kind: 'invalid', issues: [malformedBodyIssueOf(body.message)] };
  }
}
