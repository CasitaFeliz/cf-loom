import type { Visibility } from '../declarations/index.ts';
import { shapeClassOf } from './positions.ts';
import type { ChangeSite, Classification, Difference, EndpointPosition } from './report.ts';

const additive: Classification = { class: 'additive', verdict: 'allowed' };
const neutral: Classification = { class: 'neutral', verdict: 'allowed' };
const breakingRefused: Classification = { class: 'breaking', verdict: 'refused' };
const additiveRefused: Classification = { class: 'additive', verdict: 'refused' };

/**
 * The class COMPATIBILITY.md gives a difference at a site, and the Verdict on it: a Message
 * Version takes no Breaking Change but its retirement or narrowing, and a Change that rewrites
 * history is refused whatever its class.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the class and Verdict of each kind of difference
export function classificationOf(site: ChangeSite, difference: Difference): Classification {
  switch (difference.kind) {
    case 'deprecated':
    case 'visibility-widened':
    case 'param-renamed':
    case 'rejection-added':
    case 'rejection-removed':
      return additive;
    case 'added':
      return isConsumption(site) ? neutral : additive;
    case 'removed':
      return isConsumption(site) ? neutral : breakingClassificationOf(site);
    case 'reactivated':
    case 'tombstoned':
    case 'description-changed':
    case 'group-changed':
    case 'attachments-changed':
    case 'guards-changed':
    case 'qualifier-changed':
    case 'context-changed':
    case 'origin-changed':
    case 'message-changed':
    case 'against-changed':
    case 'endpoint-added':
    case 'endpoint-removed':
    case 'endpoint-renamed':
    case 'retired-changed':
    case 'code-changed':
    case 'demands-changed':
    case 'rejections-changed':
      return neutral;
    case 'retired-before-deprecated':
    case 'deleted':
    case 'identity-reused':
    case 'name-kind-changed':
    case 'event-changed':
      return breakingRefused;
    case 'export-changed':
      return { class: 'breaking', verdict: 'approval-needed' };
    case 'retired-brought-back':
    case 'version-gap':
      return additiveRefused;
    case 'retired':
    case 'visibility-narrowed':
      return retiredOrNarrowedClassificationOf(site);
    case 'status-changed':
    case 'body-added':
    case 'header-refuses-text':
    case 'shadowed':
      return breakingClassificationOf(site);
    case 'body-removed':
      return bodyRemovedClassificationOf(site, difference.position);
    case 'schema':
      return schemaClassificationOf(site, difference);
    case 'renamed':
      return renamedClassificationOf(site, difference.baselineVisibility);
  }
}

/** What a Service itself consumes, which no Consumer relies on: adding or removing it is Neutral. */
function isConsumption(site: ChangeSite): boolean {
  return site.kind === 'subscription' || site.kind === 'dependency';
}

/** Renaming an Endpoint is Breaking unless it was Private, which no Consumer calls by name. */
function renamedClassificationOf(site: ChangeSite, visibility: Visibility): Classification {
  return visibility === 'private' ? neutral : breakingClassificationOf(site);
}

function schemaClassificationOf(
  site: ChangeSite,
  difference: Extract<Difference, { readonly kind: 'schema' }>,
): Classification {
  const shapeClass = shapeClassOf(difference.shape, difference.position);
  return shapeClass === 'breaking'
    ? breakingClassificationOf(site)
    : { class: shapeClass, verdict: 'allowed' };
}

/** An Input body the Service stops reading accepts more; a Success body a Caller read is gone. */
function bodyRemovedClassificationOf(site: ChangeSite, position: EndpointPosition): Classification {
  switch (position) {
    case 'input':
      return additive;
    case 'success':
      return breakingClassificationOf(site);
  }
}

/** A Breaking Change needs an Approval, but a Message Version takes none: the check refuses it. */
function breakingClassificationOf(site: ChangeSite): Classification {
  switch (site.kind) {
    case 'event':
    case 'command':
      return breakingRefused;
    case 'endpoint':
    case 'code':
    case 'export':
    case 'guard':
    case 'subscription':
    case 'dependency':
    case 'standard-rejection':
      return { class: 'breaking', verdict: 'approval-needed' };
  }
}

/**
 * Retiring an Element or narrowing its Visibility needs an Approval, except retiring a Command: a
 * Deprecated Command is no longer sent, and the deploy rule drains it first.
 */
function retiredOrNarrowedClassificationOf(site: ChangeSite): Classification {
  switch (site.kind) {
    case 'command':
      return { class: 'breaking', verdict: 'allowed' };
    case 'endpoint':
    case 'event':
    case 'code':
    case 'export':
    case 'guard':
    case 'subscription':
    case 'dependency':
    case 'standard-rejection':
      return { class: 'breaking', verdict: 'approval-needed' };
  }
}
