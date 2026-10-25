import { isLive, type Visibility } from '../declarations/index.ts';
import {
  type CodeSnapshot,
  type DefinitionsSnapshot,
  isDeclared,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../snapshot/index.ts';
import { bodyDifferencesOf } from './bodies.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { partsOf } from './steps.ts';
import { widerOf } from './visibility.ts';

/**
 * A Service's codes by code in code point order, each its status then its body read as Success; a
 * code answered or no longer answered shows on its Endpoints instead.
 */
export function serviceCodeDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  const visibilities = answeringVisibilitiesOf(baseline, proposed);
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
 * A code on both sides by its status, then its body read as Success, a removed code the Baseline
 * remembers with what it last had; a code on one side only has nothing to compare.
 */
function comparedDifferencesOf(
  code: Counterpart<CodeSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  switch (code.kind) {
    case 'kept': {
      const { baseline, proposed } = code;
      const bodies = { baseline: baseline.body, proposed: proposed.body };
      return [
        ...statusDifferencesOf(baseline.status, proposed.status),
        ...bodyDifferencesOf(bodies, defs, { position: 'success', at: partsOf('body') }),
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
  code: Counterpart<CodeSnapshot>,
  standard: ReadonlySet<string>,
): readonly Difference[] {
  switch (code.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return code.baseline.removed || standard.has(code.key) ? [] : [{ kind: 'removed' }];
    case 'kept':
      return code.baseline.removed ? [{ kind: 'added' }] : [];
  }
}

function standardCodesOf(baseline: PublishedDefinitionsSnapshot): ReadonlySet<string> {
  return new Set(Object.values(baseline.standardRejections));
}

/**
 * The widest Visibility of the declared Endpoints of either Snapshot that list each code, so a
 * Change to a code reaches every Consumer that can see an Endpoint answering it; a Retired
 * Endpoint answers only `RETIRED`, so it counts toward none.
 */
function answeringVisibilitiesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): ReadonlyMap<string, Visibility> {
  const endpoints = [
    ...Object.values(baseline.endpoints).filter(isDeclared),
    ...Object.values(proposed.endpoints),
  ].filter(isLive);
  const visibilities = new Map<string, Visibility>();
  for (const { visibility, rejections } of endpoints) {
    for (const code of rejections) {
      visibilities.set(code, widerOf(visibilities.get(code) ?? 'private', visibility));
    }
  }
  return visibilities;
}
