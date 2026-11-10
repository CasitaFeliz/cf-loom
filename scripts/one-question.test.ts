import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../packages/messaging/test/test-process.ts';

const hookPath = join(import.meta.dirname, 'one-question.ts');

async function runHook(questions: unknown[]): Promise<{ status: number; stderr: string }> {
  const run = await runProcess('node', [hookPath], {
    input: `{"tool_name":"AskUserQuestion","tool_input":{"questions":${JSON.stringify(questions)}}}`,
  });
  return { status: run.status, stderr: run.stderr };
}

describe('the one-question hook', () => {
  it('lets a call with one question through', async () => {
    const run = await runHook([{ question: 'Which option?' }]);

    expect(run.status).toBe(0);
  });

  it('refuses a call with two questions and says how many it asks', async () => {
    const run = await runHook([{ question: 'First?' }, { question: 'Second?' }]);

    expect(run).toEqual({
      status: 2,
      stderr: 'Ask one question per call (WORKFLOW.md, Decisions); this call asks 2.\n',
    });
  });
});
