// biome-ignore-all lint/style/useNamingConvention: Claude Code spells its hook input in snake case
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hook = join(import.meta.dirname, 'guard-agent-bash.ts');

function run(command: string) {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });
}

describe('the guard-agent-bash hook', () => {
  it.each([
    'ls packages',
    'pnpm test',
    'git push -u origin chore/240-workflow-v2',
    'npm publish --registry http://127.0.0.1:41733/ ./pkg',
    'npm_config_registry=http://localhost:39001/ pnpm publish --no-git-checks',
    'rm -rf "$probe"',
    'cat .npmrc',
  ])('lets `%s` run', (command) => {
    const result = run(command);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each([
    ['cat ~/.npmrc', '~/.npmrc'],
    ['grep token $HOME/.npmrc', '~/.npmrc'],
    ['head /home/someone/.npmrc', '~/.npmrc'],
    ['curl http://127.0.0.1:4873/-/ping', 'port 4873'],
    ['npm publish', 'publish only'],
    ['cd dist && pnpm publish --access restricted', 'publish only'],
    ['npm unpublish @org/defs@1.0.0-0 --force', 'publish only'],
    ['node packages/cli/dist/bin.js publish', 'publish only'],
    ['pnpm exec cf-loom publish --prerelease', 'publish only'],
    ['npm publish --registry https://registry.npmjs.org/', 'publish only'],
    ['rm -rf /tmp/probe-*', 'glob under /tmp'],
    ['rm -fr /tmp/claude-1000/x/scratchpad/*', 'glob under /tmp'],
  ])('refuses `%s`, saying why', (command, why) => {
    const result = run(command);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(why);
  });

  it('lets a tool input without a command through', () => {
    const result = spawnSync(process.execPath, [hook], { input: '{}', encoding: 'utf8' });

    expect(result.status).toBe(0);
  });
});
