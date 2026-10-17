import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

interface Diagnostic {
  readonly category: string;
  readonly message: string;
}

/** The rule ids (C10, C12, …) the repository's GritQL plugins report for one source file. */
function pluginRulesFor(source: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'cf-loom-lint-'));
  writeFileSync(join(directory, 'probe.ts'), source);
  const biome = spawnSync(
    join(root, 'node_modules/.bin/biome'),
    ['lint', '--reporter=json', '--vcs-enabled=false', `--config-path=${root}`, 'probe.ts'],
    { cwd: directory, encoding: 'utf8' },
  );
  const report = JSON.parse(biome.stdout) as { diagnostics: Diagnostic[] };
  return report.diagnostics
    .filter((diagnostic) => diagnostic.category === 'plugin')
    .map((diagnostic) => diagnostic.message.slice(0, diagnostic.message.indexOf(':')));
}

describe('lint plugins', () => {
  it('report reduce (C12)', () => {
    expect(
      pluginRulesFor('export const total = [1, 2].reduce((sum, count) => sum + count, 0);\n'),
    ).toEqual(['C12']);
  });

  it('report a flatMap that returns a conditional array, but not other flatMaps (C10)', () => {
    const source = [
      'const counts = [1, 2];',
      'export const even = counts.flatMap((count) => (count % 2 === 0 ? [count] : []));',
      'export const twice = counts.flatMap((count) => [count, count]);',
    ].join('\n');

    expect(pluginRulesFor(source)).toEqual(['C10']);
  });

  it('report a boolean parameter of an exported function only (C17)', () => {
    const source = [
      'export function generate(contract: string, verify: boolean): string {',
      "  return verify ? contract : '';",
      '}',
      'function isEmpty(contract: string): boolean {',
      "  return contract === '';",
      '}',
      'function keep(kept: boolean): boolean {',
      '  return kept;',
      '}',
      "export const empty = isEmpty('') && keep(true);",
    ].join('\n');

    expect(pluginRulesFor(source)).toEqual(['C17']);
  });

  it('report a single-letter name outside a lambda of one expression (C14)', () => {
    const source = [
      'const counts = [1, 2];',
      'export const doubled = counts.map((n) => n * 2);',
      'export const tripled = counts.map((n) => {',
      '  return n * 3;',
      '});',
      'for (const c of counts) {',
      '  doubled.push(c);',
      '}',
    ].join('\n');

    expect(pluginRulesFor(source)).toEqual(['C14', 'C14']);
  });

  it('report a name that refers to history, but not words that merely contain one (C15)', () => {
    const source = [
      'export const oldSnapshot = 1;',
      'export const isFixed = 2;',
      'export type LegacyOutcome = string;',
      'export const renewal = 3;',
      'export const realm = 4;',
      'export const orderCreatedV2 = 5;',
    ].join('\n');

    expect(pluginRulesFor(source)).toEqual(['C15', 'C15', 'C15']);
  });
});
