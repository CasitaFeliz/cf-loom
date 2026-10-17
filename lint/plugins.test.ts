import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly start: { readonly line: number } };
}

/** Each `C<n>@<line>` the repository's GritQL plugins report for one source file. */
function pluginReportsFor(lines: readonly string[]): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'cf-loom-lint-'));
  try {
    writeFileSync(join(directory, 'probe.ts'), `${lines.join('\n')}\n`);
    const biome = spawnSync(
      join(root, 'node_modules/.bin/biome'),
      ['lint', '--reporter=json', '--vcs-enabled=false', `--config-path=${root}`, 'probe.ts'],
      { cwd: directory, encoding: 'utf8' },
    );
    const report = JSON.parse(biome.stdout) as { diagnostics: Diagnostic[] };
    return report.diagnostics
      .filter((diagnostic) => diagnostic.category === 'plugin')
      .map((diagnostic) => {
        const rule = diagnostic.message.slice(0, diagnostic.message.indexOf(':'));
        return `${rule}@${diagnostic.location.start.line}`;
      });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

describe('lint plugins', () => {
  it('report reduce and reduceRight, optional calls included (C12)', () => {
    const lines = [
      'const counts = [1, 2];',
      'export const total = counts.reduce((sum, count) => sum + count, 0);',
      'export const maybe = counts?.reduce((sum, count) => sum + count, 0);',
      'export const backwards = counts.reduceRight((sum, count) => sum + count, 0);',
    ];

    expect(pluginReportsFor(lines)).toEqual(['C12@2', 'C12@3', 'C12@4']);
  });

  it('report a flatMap whose callback returns a conditional array, but not other flatMaps (C10)', () => {
    const lines = [
      'const counts = [1, 2];',
      'export const even = counts.flatMap((count) => (count % 2 === 0 ? [count] : []));',
      'export const odd = counts.flatMap((count) => (count % 2 === 0 ? [] : [count]));',
      'export const large = counts.flatMap((count) => {',
      '  if (count > 1) {',
      '    return [count];',
      '  }',
      '  return [];',
      '});',
      'export const maybe = counts?.flatMap((count) => (count > 1 ? [count] : []));',
      'export const twice = counts.flatMap((count) => [count, count]);',
      'export const nested = counts.flatMap((count) =>',
      '  [count].map((value) => (value > 1 ? [value] : [])).flat(),',
      ');',
    ];

    expect(pluginReportsFor(lines)).toEqual(['C10@2', 'C10@3', 'C10@4', 'C10@10']);
  });

  it('report a boolean parameter of an exported function, defaults and unions included (C17)', () => {
    const lines = [
      'export function generate(contract: string, verify: boolean): string {',
      "  return verify ? contract : '';",
      '}',
      'export function prune(force = false): boolean {',
      '  return force;',
      '}',
      'export const apply = (force: boolean | undefined): boolean => force ?? false;',
      'export function keep(contract: string): string[] {',
      "  return [true].map((kept: boolean) => (kept ? contract : ''));",
      '}',
      'export type OnCommit = (committed: boolean) => void;',
      'export interface Port {',
      '  send(urgent: boolean): void;',
      '}',
      'function isEmpty(contract: string, strict: boolean): boolean {',
      "  return strict && contract === '';",
      '}',
      "export const empty = isEmpty('', true);",
    ];

    expect(pluginReportsFor(lines)).toEqual(['C17@1', 'C17@4', 'C17@7']);
  });

  it('report a single-letter name outside a lambda of one expression (C14)', () => {
    const lines = [
      "import { z } from 'zod';",
      'const counts = [1, 2];',
      'export const doubled = counts.map((n) => n * 2);',
      'export const firsts = [{ k: 1 }].map(({ k }) => k);',
      'export const indexes = counts.map((_, index) => index);',
      'try {',
      '  counts.push(z.string().length);',
      '} catch (e) {',
      '  counts.push(Number(e));',
      '}',
      'export const tripled = counts.map((n) => {',
      '  return n * 3;',
      '});',
      'for (let i = 0; i < 2; i += 1) {',
      '  counts.push(i);',
      '}',
      'export const inner = counts.map((count) =>',
      '  (() => {',
      '    const q = count;',
      '    return q;',
      '  })(),',
      ');',
    ];

    expect(pluginReportsFor(lines)).toEqual(['C14@11', 'C14@14', 'C14@19']);
  });
});
