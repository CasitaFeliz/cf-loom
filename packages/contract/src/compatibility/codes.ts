import type { Visibility } from '../declarations/index.ts';
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
 * code answered or no longer answered shows on its Endpoints instead. A code's site takes the widest
 * Visibility of the Endpoints that answer it, Private when none does.
 */
export function serviceCodeDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const visibilities = widestVisibilitiesOf(baseline, proposed, (endpoint) => endpoint.rejections);
  return codeSitesOf(baseline, proposed, (code) => visibilities.get(code) ?? 'private');
}

/**
 * A Definitions Package's codes by code in code point order, compared as a Service's are, each Public,
 * since the Services that import it may use all of it. A code added or removed is no Change here:
 * Services import a Rejection by its export, which says it.
 */
export function definitionsCodeDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  return codeSitesOf(baseline, proposed, () => 'public');
}

function codeSitesOf(
  baseline: PublishedServiceSnapshot | PublishedDefinitionsSnapshot,
  proposed: ServiceSnapshot | DefinitionsSnapshot,
  visibilityOf: (code: string) => Visibility,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  return counterpartsOf(baseline.codes, proposed.codes).map(
    (code): SiteDifferences => ({
      site: { kind: 'code', code: code.key, visibility: visibilityOf(code.key) },
      differences: comparedDifferencesOf(code, defs),
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
      const reached = codeDefsOf(baseline, defs);
      const headers = { baseline: baseline.headers, proposed: proposed.headers };
      const bodies = { baseline: baseline.body, proposed: proposed.body };
      return [
        ...statusDifferencesOf(baseline.status, proposed.status),
        ...textPartDifferencesOf(headers, reached, { position: 'success', at: partsOf('headers') }),
        ...bodyDifferencesOf(bodies, reached, { position: 'success', at: partsOf('body') }),
        ...codeNeutralOf(baseline, proposed),
      ];
    }
    case 'added':
    case 'removed':
      return [];
  }
}

/** The defs a code's `ref`s name on each side: a removed code's Baseline side is its own, as it was removed. */
function codeDefsOf(baseline: PublishedCode, defs: BothDefs): BothDefs {
  return isRemoved(baseline) ? { ...defs, baseline: baseline.defs } : defs;
}
