/**
 * A Claude Code PreToolUse hook for `Bash`: it refuses a command that would touch state every agent on the machine
 * shares, as WORKFLOW.md's Rules for every agent say: `git stash` (one stash list for every worktree, `git -C <dir>
 * stash` included), stopping processes by a pattern (`pkill`, `killall`), and `npx`, which reads the user's npm
 * configuration and the real registry. It reads the hook's JSON from stdin and exits 2, with the reason on stderr, to
 * refuse the call.
 */
import { readFileSync } from 'node:fs';

const refusedCommands: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /\bgit(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+stash\b/,
    reason:
      'Never use `git stash`: every worktree shares one stash list; commit to your own branch instead.',
  },
  {
    pattern: /\b(?:pkill|killall)\b/,
    reason: 'Stop only the processes you started, by their PID; never by a pattern.',
  },
  {
    pattern: /\bnpx\b/,
    reason:
      "Never run `npx`: it reads the user's npm configuration and the real registry; use node_modules/.bin.",
  },
];

/** Why a `Bash` call with this input is refused, or `undefined` when its command touches no shared state. */
export function refusalOf(input: unknown): string | undefined {
  const toolInput: unknown = Reflect.get(Object(input), 'tool_input');
  const command: unknown = Reflect.get(Object(toolInput), 'command');
  if (typeof command !== 'string') {
    return undefined;
  }
  return refusedCommands.find(({ pattern }) => pattern.test(command))?.reason;
}

if (import.meta.main) {
  const refusal = refusalOf(JSON.parse(readFileSync(0, 'utf8')));
  if (refusal !== undefined) {
    process.stderr.write(`${refusal}\n`);
    process.exit(2);
  }
}
