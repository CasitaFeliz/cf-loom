import { describe, expect, it } from 'vitest';
import { type CheckRun, ciOf, type MergeState, stepOf } from './merge-when-green.ts';

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

const passed = (name: string): CheckRun => ({ name, status: 'completed', conclusion: 'success' });
const running = (name: string, status = 'in_progress'): CheckRun => ({
  name,
  status,
  conclusion: null,
});

describe('what the check runs say of CI', () => {
  it('CI passed when every run on the head completed with success', () => {
    const runs = [passed('check'), passed('cli-npm (npm 11.13.0)'), passed('cli-npm (npm 12.2.1)')];

    expect(ciOf(runs)).toBe('success');
  });

  it.for([
    ['no run exists yet', []],
    ['a run is queued', [passed('check'), running('cli-npm (npm 12.2.1)', 'queued')]],
    ['a run is in progress', [passed('check'), running('cli-npm (npm 12.2.1)')]],
  ] as const)('CI is pending while %s', ([, runs]) => {
    expect(ciOf(runs)).toBe('pending');
  });

  it.for([
    ['a leg of a matrix failed', [passed('check'), conclusionOf('cli-npm (npm 12.2.1)', 'failure')]],
    ['a run was cancelled', [passed('check'), conclusionOf('cli-npm (npm 11.13.0)', 'cancelled')]],
    ['a run was skipped', [passed('check'), conclusionOf('cli-npm (npm 11.13.0)', 'skipped')]],
    [
      'one run failed while another still runs',
      [running('check'), conclusionOf('cli-npm (npm 12.2.1)', 'failure')],
    ],
  ] as const)('CI failed when %s', ([, runs]) => {
    expect(ciOf(runs)).toBe('failure');
  });

  it('on main only the runs named checks / … count', () => {
    const runs = [
      passed('checks / check'),
      passed('checks / cli-npm (npm 12.2.1)'),
      conclusionOf('publish', 'skipped'),
      running('version'),
    ];

    expect(ciOf(runs, 'checks / ')).toBe('success');
    expect(ciOf([conclusionOf('checks / cli-npm (npm 12.2.1)', 'failure'), ...runs], 'checks / ')).toBe(
      'failure',
    );
    expect(ciOf([conclusionOf('publish', 'skipped')], 'checks / ')).toBe('pending');
  });
});

function conclusionOf(name: string, conclusion: string): CheckRun {
  return { name, status: 'completed', conclusion };
}
