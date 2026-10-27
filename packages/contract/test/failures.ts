import { expect } from 'vitest';
import {
  authorPathOf,
  type Failure,
  refusalsIn,
  siteTextOf,
  type ValidatedRoot,
  type walkSchemas,
} from '../src/internal/index.ts';

/** A segment of a Snapshot path, which no failure names: `fields.` and `variants.` steps, an Element under its Group. */
const snapshotSegment =
  /(^|[ .])(fields|variants|options)\.|^groups\.[^ ]+\.(endpoints|events|commands|subscriptions)\./;

/**
 * A failure as a test compares it: where it sits as a line names it, `endpoints.GET /orders
 * (listOrders) success.status`, and what it says, without the declaration it sits in.
 */
export function summaryOf(failure: Failure) {
  const path = authorPathOf(failure.steps);
  const site = siteTextOf(failure.site);
  const location = path === null ? site : `${site} ${path}`;
  expect(location).not.toMatch(snapshotSegment);
  switch (failure.kind) {
    case 'declaration':
      return { kind: failure.kind, location, rule: failure.rule, message: failure.message };
    case 'not-allowed': {
      const { construct, instead, alsoIn, origin } = failure;
      const sites = alsoIn.map(siteTextOf);
      return {
        kind: failure.kind,
        location,
        construct,
        ...(instead && { instead }),
        alsoIn: sites,
        origin,
      };
    }
  }
}

/** A validated Root with its failures, if any, as `summaryOf` gives them; a valid one is itself. */
export function summarized(validated: ValidatedRoot) {
  if (validated.kind === 'valid') {
    return validated;
  }
  return { kind: validated.kind, failures: validated.failures.map(summaryOf) };
}

/**
 * A walk with each refusal as the steps it sits at in the author's terms, `fields.a` being `a`
 * and `items` being `[]`, with the construct, and what to use instead.
 */
export function refusalsOf({ located, defs }: ReturnType<typeof walkSchemas>) {
  return {
    located: located.map(({ walked }) =>
      walked.kind === 'walked'
        ? walked
        : {
            kind: walked.kind,
            failures: refusalsIn([walked.tree]).map(({ steps, construct, instead }) => ({
              kind: 'not-allowed',
              at: authorPathOf(steps) ?? '',
              construct,
              ...(instead && { instead }),
            })),
          },
    ),
    defs,
  };
}
