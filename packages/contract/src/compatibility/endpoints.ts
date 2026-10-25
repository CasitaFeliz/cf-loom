import type { EndpointSnapshot } from '../snapshot/index.ts';
import { bodyDifferencesOf } from './bodies.ts';
import { answeredDifferencesOf, statusDifferencesOf } from './codes.ts';
import type { BothDefs } from './findings.ts';
import type { Pair } from './pairs.ts';
import type { ChangeSite, Difference } from './report.ts';
import { partsOf } from './steps.ts';
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
 * What an Endpoint kept by identity changed in what it reads and answers: its Input (params,
 * query, headers and body), its Success (status, headers and body), then the codes it answers.
 */
export function endpointDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  if (pair.kind !== 'kept') {
    return [];
  }
  const { baseline, proposed } = pair;
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
  const before = baseline.input;
  const after = proposed.input;
  const query = { baseline: before.query, proposed: after.query };
  const headers = { baseline: before.headers, proposed: after.headers };
  const body = { baseline: before.body, proposed: after.body };
  return [
    ...paramDifferencesOf(baseline, proposed, defs),
    ...textPartDifferencesOf(query, defs, { position: 'input', at: partsOf('input', 'query') }),
    ...inputHeaderDifferencesOf(headers, defs, partsOf('input', 'headers')),
    ...bodyDifferencesOf(body, defs, { position: 'input', at: partsOf('input', 'body') }),
  ];
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
