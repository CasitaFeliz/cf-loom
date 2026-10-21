import type { Visibility } from '../declarations/index.ts';
import { shapeClassOf } from './positions.ts';
import type { BodyPosition, ChangeSite, Classification, Difference } from './report.ts';

/**
 * The class COMPATIBILITY.md gives a difference at a site, and whether it needs a Breaking Change
 * Approval: an Endpoint's and a shared schema's does, a Message's is gated by its conditions instead.
 */
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
      return { class: 'not-allowed' };
    case 'retired':
    case 'visibility-narrowed':
    case 'removed':
    case 'status-changed':
    case 'body-added':
    case 'header-refuses-text':
      return { class: 'breaking', approval: approvalOf(site) };
    case 'body-removed':
      return bodyRemovedClassOf(site, difference.position);
    case 'schema':
      return schemaClassOf(site, difference);
    case 'renamed':
      return renamedClassOf(difference.visibility);
  }
}

/** Renaming an Endpoint is Breaking unless it is Private, which no Consumer calls by name. */
function renamedClassOf(visibility: Visibility): Classification {
  return visibility === 'private'
    ? { class: 'neutral' }
    : { class: 'breaking', approval: 'needed' };
}

function schemaClassOf(
  site: ChangeSite,
  difference: Extract<Difference, { readonly kind: 'schema' }>,
): Classification {
  const shapeClass = shapeClassOf(difference.shape, difference.position);
  return shapeClass === 'breaking'
    ? { class: 'breaking', approval: approvalOf(site) }
    : { class: shapeClass };
}

/** An Input body the Service stops reading accepts more; a Success body a Caller read is gone. */
function bodyRemovedClassOf(site: ChangeSite, position: BodyPosition): Classification {
  switch (position) {
    case 'input':
      return { class: 'additive' };
    case 'success':
      return { class: 'breaking', approval: approvalOf(site) };
  }
}

function approvalOf(site: ChangeSite): 'needed' | 'not-needed' {
  switch (site.kind) {
    case 'endpoint':
    case 'shared-schema':
      return 'needed';
    case 'event':
    case 'command':
      return 'not-needed';
  }
}
