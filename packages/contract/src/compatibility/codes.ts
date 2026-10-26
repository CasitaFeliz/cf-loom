import {
  type CodeSnapshot,
  type DefinitionsSnapshot,
  isRemoved,
  type PublishedCode,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../snapshot/index.ts';
import { partsOf } from '../walker/index.ts';
import { bodyDifferencesOf } from './bodies.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import { codeNeutralOf } from './neutral.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { textPartDifferencesOf } from './text-parts.ts';
import { widestVisibilitiesOf } from './visibility.ts';

/**
 * A Service's codes by code in code point order, each its status, headers then body read as Success; a
 * code answered or no longer answered shows on its Endpoints instead.
 */
export function serviceCodeDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  const visibilities = widestVisibilitiesOf(baseline, proposed, (endpoint) => endpoint.rejections);
  return counterpartsOf(baseline.codes, proposed.codes).map(
    (code): SiteDifferences => ({
      site: { kind: 'code', code: code.key, visibility: visibilities.get(code.key) ?? 'private' },
      differences: comparedDifferencesOf(code, defs),
    }),
  );
}

/**
 * A Definitions Package's codes by code in code point order: added or removed, since Services
 * import its Rejections by name, then compared as a Service's are.
 */
export function definitionsCodeDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  const standard = standardCodesOf(baseline);
  return counterpartsOf(baseline.codes, proposed.codes).map(
    (code): SiteDifferences => ({
      site: { kind: 'code', code: code.key, visibility: 'public' },
      differences: [...presenceDifferencesOf(code, standard), ...comparedDifferencesOf(code, defs)],
    }),
  );
}

/** The codes an Endpoint or a Guard answers, added and removed: codes are open for Callers, so each is Additive. */
export function answeredDifferencesOf(
  baseline: readonly string[],
  proposed: readonly string[],
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const code of counterpartsOf(byCodeOf(baseline), byCodeOf(proposed))) {
    switch (code.kind) {
      case 'added':
        differences.push({ kind: 'rejection-added', code: code.key });
        break;
      case 'removed':
        differences.push({ kind: 'rejection-removed', code: code.key });
        break;
      case 'kept':
        break;
    }
  }
  return differences;
}

function byCodeOf(codes: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(codes.map((code) => [code, code]));
}

/** A status changed, which Callers may depend on: a Success's or a code's. */
export function statusDifferencesOf(baseline: number, proposed: number): readonly Difference[] {
  return baseline === proposed ? [] : [{ kind: 'status-changed', from: baseline, to: proposed }];
}

/**
 * A code on both sides by its status, then its headers and body read as Success, then its message and origin,
 * a removed code the Baseline remembers with what it last had; a code on one side only has
 * nothing to compare.
 */
function comparedDifferencesOf(
  code: Counterpart<PublishedCode, CodeSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  switch (code.kind) {
    case 'kept': {
      const { baseline, proposed } = code;
      const headers = { baseline: baseline.headers, proposed: proposed.headers };
      const bodies = { baseline: baseline.body, proposed: proposed.body };
      return [
        ...statusDifferencesOf(baseline.status, proposed.status),
        ...textPartDifferencesOf(headers, defs, { position: 'success', at: partsOf('headers') }),
        ...bodyDifferencesOf(bodies, defs, { position: 'success', at: partsOf('body') }),
        ...codeNeutralOf(baseline, proposed),
      ];
    }
    case 'added':
    case 'removed':
      return [];
  }
}

/**
 * Whether a Definitions Package declares a code now or no longer, but for the code a Standard
 * Rejection resolved to, which Services never name.
 */
function presenceDifferencesOf(
  code: Counterpart<PublishedCode, CodeSnapshot>,
  standard: ReadonlySet<string>,
): readonly Difference[] {
  switch (code.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return isRemoved(code.baseline) || standard.has(code.key) ? [] : [{ kind: 'removed' }];
    case 'kept':
      return isRemoved(code.baseline) ? [{ kind: 'added' }] : [];
  }
}

function standardCodesOf(baseline: PublishedDefinitionsSnapshot): ReadonlySet<string> {
  return new Set(Object.values(baseline.standardRejections));
}
