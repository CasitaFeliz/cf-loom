import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../packages/messaging/test/test-process.ts';
import { bumpProblem, type ChangesetStatus } from './check-changeset-bump.ts';

const statusDirs: string[] = [];

function aStatusWith(bumps: Record<string, 'major' | 'minor' | 'patch' | 'none'>): ChangesetStatus {
  return {
    changesets: Object.entries(bumps).map(([id, type]) => ({ id, releases: [{ type }] })),
  };
}

async function runCheck(
  title: string,
  status: ChangesetStatus,
): Promise<{ status: number; stderr: string }> {
  const statusDir = mkdtempSync(join(tmpdir(), 'check-changeset-bump-'));
  statusDirs.push(statusDir);
  const statusPath = join(statusDir, 'status.json');
  writeFileSync(statusPath, JSON.stringify(status));
  const run = await runProcess('node', [
    join(import.meta.dirname, 'check-changeset-bump.ts'),
    title,
    statusPath,
  ]);
  return { status: run.status, stderr: run.stderr };
}

afterEach(() => {
  for (const statusDir of statusDirs.splice(0)) {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

describe('bumpProblem', () => {
  it('accepts a title with "!" and a major changeset', () => {
    const problem = bumpProblem(
      'feat(handlers)!: success takes its declaration first',
      aStatusWith({ 'one-place': 'major', 'a-fix': 'patch' }),
    );

    expect(problem).toBeUndefined();
  });

  it('accepts a title with "!" and no scope', () => {
    const problem = bumpProblem(
      'feat!: every object refuses an undeclared field',
      aStatusWith({ 'closed-objects': 'major' }),
    );

    expect(problem).toBeUndefined();
  });

  it('refuses a title with "!" when no changeset is major', () => {
    const problem = bumpProblem(
      'feat!: a refusal of what used to work',
      aStatusWith({ 'a-feature': 'minor', 'a-fix': 'patch' }),
    );

    expect(problem).toBe(
      'the title has "!", so a changeset must bump a package major, or the title drops the "!".',
    );
  });

  it('refuses a title with "!" when the PR carries only an empty changeset', () => {
    const problem = bumpProblem('fix!: a refusal of what used to work', {
      changesets: [{ id: 'empty', releases: [] }],
    });

    expect(problem).toContain('the title has "!"');
  });

  it('refuses a title with "!" when the PR carries no changeset', () => {
    const problem = bumpProblem('chore!: drop a thing', { changesets: [] });

    expect(problem).toContain('the title has "!"');
  });

  it('refuses a title without "!" when a changeset is major, naming it', () => {
    const problem = bumpProblem(
      'feat(cli): a new command',
      aStatusWith({ 'a-feature': 'minor', 'extra-major': 'major', 'other-major': 'major' }),
    );

    expect(problem).toBe(
      'a changeset bumps a package major (extra-major, other-major), so the title needs "!": `type!: …` or `type(scope)!: …`.',
    );
  });

  it('accepts a title without "!" and no major changeset', () => {
    const problem = bumpProblem(
      'fix(client): a typo',
      aStatusWith({ 'a-fix': 'patch', 'an-empty-one': 'none' }),
    );

    expect(problem).toBeUndefined();
  });

  it('accepts a title without "!" when the PR carries no changeset', () => {
    const problem = bumpProblem('ci: a runner', { changesets: [] });

    expect(problem).toBeUndefined();
  });

  it('reads "!" only after the type and scope', () => {
    const problem = bumpProblem(
      'feat: a command that says hello!: loudly',
      aStatusWith({ 'extra-major': 'major' }),
    );

    expect(problem).toContain('(extra-major)');
  });
});

describe('check-changeset-bump', () => {
  it('exits 0 when the changesets agree with the title', async () => {
    const run = await runCheck('feat!: a break', aStatusWith({ 'a-break': 'major' }));

    expect(run).toEqual({ status: 0, stderr: '' });
  });

  it('exits 1 and says why when they disagree', async () => {
    const run = await runCheck('fix: a typo', aStatusWith({ 'a-break': 'major' }));

    expect(run).toEqual({
      status: 1,
      stderr:
        'changeset bump: a changeset bumps a package major (a-break), so the title needs "!": `type!: …` or `type(scope)!: …`.\n',
    });
  });

  it('exits 1 when it is not given the title and the status file', async () => {
    const run = await runProcess('node', [join(import.meta.dirname, 'check-changeset-bump.ts')]);

    expect(run.status).toBe(1);
  });
});
