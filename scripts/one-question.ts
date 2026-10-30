/**
 * A Claude Code PreToolUse hook for `AskUserQuestion`: it refuses a call that asks more than one question, since
 * WORKFLOW.md's Decisions asks each question alone. It reads the hook's JSON from stdin and exits 2, with the reason
 * on stderr, to refuse the call.
 */
import { readFileSync } from 'node:fs';

/** Why a call to `AskUserQuestion` with this input is refused, or `undefined` when it asks one question. */
export function refusalOf(input: unknown): string | undefined {
  const toolInput: unknown = Reflect.get(Object(input), 'tool_input');
  const questions: unknown = Reflect.get(Object(toolInput), 'questions');
  if (!Array.isArray(questions) || questions.length <= 1) {
    return undefined;
  }
  return `Ask one question per call (WORKFLOW.md, Decisions); this call asks ${questions.length}.`;
}

if (import.meta.main) {
  const refusal = refusalOf(JSON.parse(readFileSync(0, 'utf8')));
  if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exit(2);
  }
}
