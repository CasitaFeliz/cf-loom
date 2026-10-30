import { describe, expect, it } from 'vitest';
import { refusalOf } from './shared-state-commands.ts';

function bashCall(command: string): unknown {
  return JSON.parse(`{"tool_name":"Bash","tool_input":{"command":${JSON.stringify(command)}}}`);
}

describe('the shared-state commands hook', () => {
  it.each([
    'git stash',
    'git -C /home/me/cf-loom-12 stash pop',
    'cd /tmp/x && git stash list',
    'pkill -f "pnpm test"',
    'killall node',
    'npx -y npm@11 --version',
  ])('refuses %s', (command) => {
    expect(refusalOf(bashCall(command))).toBeDefined();
  });

  it.each([
    'git status && git log --oneline -3',
    'git commit -m "docs: say why we never stash"',
    'kill 12345',
    'pnpm exec cf-loom check',
  ])('lets %s through', (command) => {
    expect(refusalOf(bashCall(command))).toBeUndefined();
  });
});
