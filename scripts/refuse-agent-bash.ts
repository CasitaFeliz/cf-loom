// biome-ignore-all lint/style/useNamingConvention: Claude Code spells its hook input in snake case
import { readFileSync } from 'node:fs';

/**
 * One command of a Bash line, between `;`, `&` or `|`: `said` as written, `run` with the text inside quotes blanked
 * so that what a command only mentions (a grep pattern, a commit message) is not taken for what it runs.
 */
type Part = { readonly said: string; readonly run: string; readonly before: string };

/** A rule every agent follows ([WORKFLOW.md](../WORKFLOW.md#rules-for-every-agent)), and how a command breaks it. */
type Rule = { readonly breaks: (part: Part) => boolean; readonly reason: string };

const quoted = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const loopback = String.raw`https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])[:/]`;
const loopbackFlag = new RegExp(String.raw`--registry[= ]['"]?${loopback}`, 'i');
const loopbackEnv = new RegExp(String.raw`npm_config_registry=['"]?${loopback}`, 'i');
const otherRegistry = new RegExp(String.raw`--registry[= ]['"]?(?!${loopback})`, 'i');
const publishing = /(?:\bnpm|\bpnpm|\byarn|\bcf-loom|cli\/dist\/bin\.js)\b.*\s(?:un)?publish\b/;

function toLoopback({ said, before }: Part): boolean {
  if (otherRegistry.test(said)) return false;
  return loopbackFlag.test(said) || loopbackEnv.test(before + said);
}

const rules: readonly Rule[] = [
  {
    breaks: ({ said }) => /(?:~|\$\{?HOME\}?|\/home\/[^/\s]+|\/root)["']?\/\.npmrc\b/.test(said),
    reason: 'the user’s ~/.npmrc holds registry credentials: never read or print it',
  },
  {
    breaks: ({ said }) => /:4873\b/.test(said),
    reason: 'port 4873 is the user’s own registry: start a registry of your own on port 0',
  },
  {
    breaks: (part) => publishing.test(part.run) && !toLoopback(part),
    reason:
      'publish only to a registry of your own on 127.0.0.1, named with --registry or npm_config_registry=',
  },
  {
    breaks: ({ run }) => /\brm\s+-\w*[rR].*\/tmp\/\S*\*/.test(run),
    reason: 'never delete a glob under /tmp: name the directories you created',
  },
];

function partsOf(command: string): Part[] {
  const blanked = command.replace(
    quoted,
    (text) => `${text[0]}${' '.repeat(text.length - 2)}${text[0]}`,
  );
  const parts: Part[] = [];
  let start = 0;
  for (const run of blanked.split(/(?<=[;&|\n])/)) {
    const end = start + run.length;
    parts.push({ said: command.slice(start, end), run, before: command.slice(0, start) });
    start = end;
  }
  return parts;
}

/** Why `command` must not run, or `undefined` when it breaks no rule. */
function refusal(command: string): string | undefined {
  const parts = partsOf(command);
  return rules.find((rule) => parts.some(rule.breaks))?.reason;
}

const input: { tool_input?: { command?: unknown } } = JSON.parse(readFileSync(0, 'utf8'));
const command = input.tool_input?.command;
const reason = typeof command === 'string' ? refusal(command) : undefined;
if (reason !== undefined) {
  process.stderr.write(`Refused by scripts/refuse-agent-bash.ts: ${reason}.\n`);
  process.exit(2);
}
