import type { EndpointSnapshot } from '../snapshot/index.ts';
import { bodyDifferencesOf } from './bodies.ts';
import { answeredDifferencesOf } from './codes.ts';
import type { BothDefs } from './findings.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';
import {
  inputHeaderDifferencesOf,
  paramDifferencesOf,
  textPartDifferencesOf,
} from './text-parts.ts';

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
    ...textPartDifferencesOf(query, defs, { position: 'input', at: ['input', 'query'] }),
    ...inputHeaderDifferencesOf(headers, defs, ['input', 'headers']),
    ...bodyDifferencesOf(body, defs, { position: 'input', at: ['input', 'body'] }),
  ];
}

function successDifferencesOf(
  baseline: EndpointSnapshot['success'],
  proposed: EndpointSnapshot['success'],
  defs: BothDefs,
): readonly Difference[] {
  const headers = { baseline: baseline.headers, proposed: proposed.headers };
  const body = { baseline: baseline.body, proposed: proposed.body };
  const status: Difference[] =
    baseline.status === proposed.status
      ? []
      : [{ kind: 'status-changed', from: baseline.status, to: proposed.status }];
  return [
    ...status,
    ...textPartDifferencesOf(headers, defs, { position: 'success', at: ['success', 'headers'] }),
    ...bodyDifferencesOf(body, defs, { position: 'success', at: ['success', 'body'] }),
  ];
}
