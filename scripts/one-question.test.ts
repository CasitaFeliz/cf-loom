import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hookPath = join(import.meta.dirname, 'one-question.ts');

function runHook(questions: unknown[]): { status: number | null; stderr: string } {
  const run = spawnSync('node', [hookPath], {
    input: `{"tool_name":"AskUserQuestion","tool_input":{"questions":${JSON.stringify(questions)}}}`,
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr };
}

describe('the one-question hook', () => {
  it('lets a call with one question through', () => {
    const run = runHook([{ question: 'Which option?' }]);

    expect(run.status).toBe(0);
  });

  it('refuses a call with two questions and says how many it asks', () => {
    const run = runHook([{ question: 'First?' }, { question: 'Second?' }]);

    expect(run).toEqual({
      status: 2,
      stderr: 'Ask one question per call (WORKFLOW.md, Decisions); this call asks 2.\n',
    });
  });
});
