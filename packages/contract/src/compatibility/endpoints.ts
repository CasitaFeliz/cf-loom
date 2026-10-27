import type { EndpointSnapshot, InputSnapshot } from '../snapshot/index.ts';
import { partsOf } from '../walker/index.ts';
import { bodyDifferencesOf } from './bodies.ts';
import { answeredDifferencesOf, statusDifferencesOf } from './codes.ts';
import type { BothDefs } from './findings.ts';
import { comparedShapesOf, type Pair } from './pairs.ts';
import type { ChangeSite, Difference } from './report.ts';
import {
  inputHeaderDifferencesOf,
  paramDifferencesOf,
  textPartDifferencesOf,
} from './text-parts.ts';
import { siteVisibilityOf } from './visibility.ts';

/**
 * The site of an Endpoint: its identity, its name, the proposed one or the Baseline's when it is
 * dropped, and the Visibility that decides the bump.
 */
export function endpointSiteOf(pair: Pair<EndpointSnapshot>): ChangeSite {
  const { name } = pair.kind === 'dropped' ? pair.baseline : pair.proposed;
  return { kind: 'endpoint', identity: pair.identity, name, visibility: siteVisibilityOf(pair) };
}

/**
 * What an Endpoint kept by identity, and not Retired now, changed in what it reads and answers:
 * its Input (params, query, headers and body), its Success (status, headers and body), then the
 * codes it answers.
 */
export function endpointDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const { baseline, proposed } = compared;
  return [
    ...inputDifferencesOf(baseline, proposed, defs),
    ...successDifferencesOf(baseline.success, proposed.success, defs),
    ...answeredDifferencesOf(baseline.rejections, proposed.rejections),
  ];
}

function inputDifferencesOf(
  baseline: EndpointSnapshot,
  proposed: EndpointSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const headers = { baseline: baseline.input.headers, proposed: proposed.input.headers };
  return [
    ...paramDifferencesOf(baseline, proposed, defs),
    ...queryDifferencesOf(baseline.input, proposed.input, defs),
    ...inputHeaderDifferencesOf(headers, defs, partsOf('input', 'headers')),
    ...inputBodyDifferencesOf(baseline.input, proposed.input, defs),
  ];
}

/** The query a Caller sends, compared as Input: an Endpoint's, or a former Input's. */
export function queryDifferencesOf(
  before: Pick<InputSnapshot, 'query'>,
  after: Pick<InputSnapshot, 'query'>,
  defs: BothDefs,
): readonly Difference[] {
  const query = { baseline: before.query, proposed: after.query };
  return textPartDifferencesOf(query, defs, { position: 'input', at: partsOf('input', 'query') });
}

/** The body a Caller sends, compared as Input: an Endpoint's, or a former Input's. */
export function inputBodyDifferencesOf(
  before: Pick<InputSnapshot, 'body'>,
  after: Pick<InputSnapshot, 'body'>,
  defs: BothDefs,
): readonly Difference[] {
  const body = { baseline: before.body, proposed: after.body };
  return bodyDifferencesOf(body, defs, { position: 'input', at: partsOf('input', 'body') });
}

function successDifferencesOf(
  baseline: EndpointSnapshot['success'],
  proposed: EndpointSnapshot['success'],
  defs: BothDefs,
): readonly Difference[] {
  const headers = { baseline: baseline.headers, proposed: proposed.headers };
  const body = { baseline: baseline.body, proposed: proposed.body };
  return [
    ...statusDifferencesOf(baseline.status, proposed.status),
    ...textPartDifferencesOf(headers, defs, {
      position: 'success',
      at: partsOf('success', 'headers'),
    }),
    ...bodyDifferencesOf(body, defs, { position: 'success', at: partsOf('success', 'body') }),
  ];
}
