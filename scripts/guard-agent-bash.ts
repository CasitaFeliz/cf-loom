// biome-ignore-all lint/style/useNamingConvention: Claude Code spells its hook input in snake case
import { readFileSync } from 'node:fs';

/** A rule every agent follows ([WORKFLOW.md](../WORKFLOW.md#rules-for-every-agent)), and how a command breaks it. */
type Guard = { readonly breaks: (command: string) => boolean; readonly reason: string };

const loopbackRegistry =
  /(?:--registry[= ]|npm_config_registry=)['"]?https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])[:/]/i;
const publishing =
  /(?:\bnpm|\bpnpm|\byarn|\bcf-loom|cli\/dist\/bin\.js)\b[^;&|\n]*\s(?:un)?publish\b/;

const guards: readonly Guard[] = [
  {
    breaks: (command) => /(?:~|\$\{?HOME\}?|\/home\/[^/\s]+|\/root)\/\.npmrc\b/.test(command),
    reason: 'the user’s ~/.npmrc holds registry credentials: never read or print it',
  },
  {
    breaks: (command) => /:4873\b/.test(command),
    reason: 'port 4873 is the user’s own registry: start a registry of your own on port 0',
  },
  {
    breaks: (command) => publishing.test(command) && !loopbackRegistry.test(command),
    reason: 'publish only to a registry of your own on 127.0.0.1, named with --registry',
  },
  {
    breaks: (command) => /\brm\s+-\w*[rR][^;&|\n]*\/tmp\/\S*\*/.test(command),
    reason: 'never delete a glob under /tmp: name the directories you created',
  },
];

/** Why `command` must not run, or `undefined` when it breaks no rule. */
function refusal(command: string): string | undefined {
  return guards.find((guard) => guard.breaks(command))?.reason;
}

const input: { tool_input?: { command?: unknown } } = JSON.parse(readFileSync(0, 'utf8'));
const command = input.tool_input?.command;
const reason = typeof command === 'string' ? refusal(command) : undefined;
if (reason !== undefined) {
  process.stderr.write(`Refused by scripts/guard-agent-bash.ts: ${reason}.\n`);
  process.exit(2);
}
