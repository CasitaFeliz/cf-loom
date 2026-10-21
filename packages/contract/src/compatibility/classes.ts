import type { ChangeSite, Classification, Difference } from './report.ts';

/**
 * The class COMPATIBILITY.md gives a difference at a site, and whether it needs a Breaking Change
 * Approval: an Endpoint's does, a Message's is gated by its conditions instead.
 */
export function classificationOf(site: ChangeSite, difference: Difference): Classification {
  switch (difference.kind) {
    case 'added':
    case 'deprecated':
    case 'visibility-widened':
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
      return { class: 'breaking', approval: approvalOf(site) };
    case 'renamed':
      return difference.visibility === 'private'
        ? { class: 'neutral' }
        : { class: 'breaking', approval: 'needed' };
  }
}

function approvalOf(site: ChangeSite): 'needed' | 'not-needed' {
  switch (site.kind) {
    case 'endpoint':
      return 'needed';
    case 'event':
    case 'command':
      return 'not-needed';
  }
}
