import { describe, expect, it } from 'vitest';
import { type MergeState, stepOf } from './merge-when-green.ts';

const green: MergeState = { check: 'success', mergeable: 'MERGEABLE', mainCheck: 'success' };

describe('when a done PR merges', () => {
  it('merges once CI passed on the head, the PR is mergeable and main is green', () => {
    expect(stepOf(green)).toEqual({ kind: 'merge' });
  });

  it('waits while CI runs on the head', () => {
    expect(stepOf({ ...green, check: 'pending' })).toEqual({ kind: 'wait' });
  });

  it('waits while GitHub has not judged the PR mergeable yet', () => {
    expect(stepOf({ ...green, mergeable: 'UNKNOWN' })).toEqual({ kind: 'wait' });
  });

  it('refuses when CI failed on the head', () => {
    expect(stepOf({ ...green, check: 'failure' })).toEqual({
      kind: 'refuse',
      reason: 'CI failed on the head',
    });
  });

  it('refuses a conflicting PR instead of waiting for a CI run it never gets', () => {
    expect(stepOf({ ...green, check: 'pending', mergeable: 'CONFLICTING' })).toEqual({
      kind: 'refuse',
      reason: 'the PR conflicts with main; merge main into it first',
    });
  });

  it('refuses while the last CI run on main failed', () => {
    expect(stepOf({ ...green, mainCheck: 'failure' })).toEqual({
      kind: 'refuse',
      reason: 'the last CI run on main failed; fix main before the next merge',
    });
  });
});
