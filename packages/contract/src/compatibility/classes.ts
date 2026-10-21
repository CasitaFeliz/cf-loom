import type { Visibility } from '../declarations/index.ts';
import { shapeClassOf } from './positions.ts';
import type {
  ChangeSite,
  Classification,
  Difference,
  EndpointPosition,
  GraphDependency,
} from './report.ts';

/**
 * The class COMPATIBILITY.md gives a difference at a site, and whether it needs a Breaking Change
 * Approval: a Message Version takes no Breaking Change but its retirement or narrowing, which its
 * conditions gate instead of an Approval.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the class of each kind of difference
export function classificationOf(site: ChangeSite, difference: Difference): Classification {
  switch (difference.kind) {
    case 'added':
    case 'deprecated':
    case 'visibility-widened':
    case 'param-renamed':
    case 'rejection-added':
    case 'rejection-removed':
      return { class: 'additive' };
    case 'reactivated':
    case 'tombstoned':
      return { class: 'neutral' };
    case 'retired-before-deprecated':
    case 'retired-brought-back':
    case 'deleted':
    case 'identity-reused':
    case 'version-gap':
    case 'name-kind-changed':
    case 'event-changed':
      return { class: 'not-allowed' };
    case 'retired':
    case 'visibility-narrowed':
      return gatedClassOf(site, difference.dependencies);
    case 'removed':
    case 'status-changed':
    case 'body-added':
    case 'header-refuses-text':
    case 'shadowed':
      return breakingClassOf(site);
    case 'body-removed':
      return bodyRemovedClassOf(site, difference.position);
    case 'schema':
      return schemaClassOf(site, difference);
    case 'renamed':
      return renamedClassOf(site, difference.visibility);
  }
}

/** Renaming an Endpoint is Breaking unless it is Private, which no Consumer calls by name. */
function renamedClassOf(site: ChangeSite, visibility: Visibility): Classification {
  return visibility === 'private' ? { class: 'neutral' } : breakingClassOf(site);
}

function schemaClassOf(
  site: ChangeSite,
  difference: Extract<Difference, { readonly kind: 'schema' }>,
): Classification {
  const shapeClass = shapeClassOf(difference.shape, difference.position);
  return shapeClass === 'breaking' ? breakingClassOf(site) : { class: shapeClass };
}

/** An Input body the Service stops reading accepts more; a Success body a Caller read is gone. */
function bodyRemovedClassOf(site: ChangeSite, position: EndpointPosition): Classification {
  switch (position) {
    case 'input':
      return { class: 'additive' };
    case 'success':
      return breakingClassOf(site);
  }
}

/**
 * How a Breaking Change gets through a site: an Approval at every site, but a Message Version's
 * retirement or narrowing, which its conditions gate. A Subscription is no Message Version, so a
 * Breaking Change on it would need an Approval.
 */
function gateOf(site: ChangeSite): 'approval' | 'conditions' {
  switch (site.kind) {
    case 'event':
    case 'command':
      return 'conditions';
    case 'endpoint':
    case 'code':
    case 'shared-schema':
    case 'guard':
    case 'subscription':
      return 'approval';
  }
}

/** A Breaking Change that needs an Approval, or that a Message Version's conditions refuse outright. */
function breakingClassOf(site: ChangeSite): Classification {
  switch (gateOf(site)) {
    case 'approval':
      return { class: 'breaking', approval: 'needed' };
    case 'conditions':
      return { class: 'not-allowed' };
  }
}

/** A retirement or narrowing is Not allowed while a Dependency would lose the Element, else Breaking. */
function gatedClassOf(site: ChangeSite, dependencies: readonly GraphDependency[]): Classification {
  if (dependencies.length > 0) {
    return { class: 'not-allowed' };
  }
  return { class: 'breaking', approval: gateOf(site) === 'approval' ? 'needed' : 'not-needed' };
}
