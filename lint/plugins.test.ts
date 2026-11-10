import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Ran, runProcess } from '../packages/messaging/test/test-process.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

interface Diagnostic {
  readonly category: string;
  readonly message: string;
  readonly location: { readonly start: { readonly line: number } };
}

/** The JSON report Biome printed, which it does at status 0 and at status 1, or a failure naming how Biome ended and its stderr. */
function reportOf(biome: Ran): { diagnostics: Diagnostic[] } {
  try {
    return JSON.parse(biome.stdout) as { diagnostics: Diagnostic[] };
  } catch {
    const printed = `${biome.stdout.length} characters`;
    throw new Error(
      `biome ended with status ${biome.status} and printed ${printed}: ${biome.stderr}`,
    );
  }
}

/** Each `C<n>@<line>` the repository's GritQL plugins report for `probe.ts` or the file given, in the order of the lines. */
async function pluginReportsFor(lines: readonly string[], file = 'probe.ts'): Promise<string[]> {
  const directory = mkdtempSync(join(tmpdir(), 'cf-loom-lint-'));
  try {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), `${lines.join('\n')}\n`);
    const biome = await runProcess(
      join(root, 'node_modules/.bin/biome'),
      ['lint', '--reporter=json', '--vcs-enabled=false', `--config-path=${root}`, file],
      { cwd: directory },
    );
    return reportOf(biome)
      .diagnostics.filter((diagnostic) => diagnostic.category === 'plugin')
      .sort((first, second) => first.location.start.line - second.location.start.line)
      .map((diagnostic) => {
        const rule = diagnostic.message.slice(0, diagnostic.message.indexOf(':'));
        return `${rule}@${diagnostic.location.start.line}`;
      });
  } finally {
    rmSync(directory, { recursive: true });
  }
}

describe('lint plugins', () => {
  it('report reduce and reduceRight, optional calls included (C12)', async () => {
    const lines = [
      'const counts = [1, 2];',
      'export const total = counts.reduce((sum, count) => sum + count, 0);',
      'export const maybe = counts?.reduce((sum, count) => sum + count, 0);',
      'export const backwards = counts.reduceRight((sum, count) => sum + count, 0);',
    ];

    expect(await pluginReportsFor(lines)).toEqual(['C12@2', 'C12@3', 'C12@4']);
  });

  it('report a spread into push, unshift or splice, optional calls included, but not a spread in an array literal or into another call (C29)', async () => {
    const lines = [
      'const list = [1];',
      'const more = [2, 3];',
      'list.push(...more);',
      'list?.push(1, ...more);',
      'list.unshift(...more);',
      'list?.unshift(...more);',
      'list.splice(0, 0, ...more);',
      'list?.splice(0, 0, ...more);',
      'list.push(more[0]);',
      'export const joined = [...list, ...more];',
      'console.log(...more);',
      'list.push({ ...more });',
      'list.push([...more]);',
    ];

    expect(await pluginReportsFor(lines)).toEqual([
      'C29@3',
      'C29@4',
      'C29@5',
      'C29@6',
      'C29@7',
      'C29@8',
    ]);
  });

  it('report a flatMap whose callback returns a conditional array, but not other flatMaps (C10)', async () => {
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

    expect(await pluginReportsFor(lines)).toEqual(['C10@2', 'C10@3', 'C10@4', 'C10@10']);
  });

  it('report a boolean parameter of an exported function, defaults and unions included (C17)', async () => {
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

    expect(await pluginReportsFor(lines)).toEqual(['C17@1', 'C17@4', 'C17@7']);
  });

  it('report a single-letter name outside a lambda of one expression (C14)', async () => {
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

    expect(await pluginReportsFor(lines)).toEqual(['C14@11', 'C14@14', 'C14@19']);
  });

  it('report a clock read in a test file, not in other files or other time functions (C30)', async () => {
    const lines = [
      'export const started = performance.now();',
      'export const stamped = Date.now();',
      'export const global = globalThis.performance.now();',
      'export const tick = process.hrtime();',
      'export const elapsed = process.hrtime(tick);',
      'export const exact = process.hrtime.bigint();',
      'export const cpu = process.cpuUsage();',
      'export const threadCpu = process.threadCpuUsage(cpu);',
      'export const fixed = new Date(0).getTime();',
      "export const parsed = Date.parse('2026-01-01');",
      'export const random = Math.random();',
      'export const usage = process.memoryUsage();',
    ];

    expect(await pluginReportsFor(lines, 'probe.test.ts')).toEqual([
      'C30@1',
      'C30@2',
      'C30@3',
      'C30@4',
      'C30@5',
      'C30@6',
      'C30@7',
      'C30@8',
    ]);
    expect(await pluginReportsFor(lines, 'growth.ts')).toEqual([]);
    expect(await pluginReportsFor(lines)).toEqual([]);
  });

  it('report a spy on the console outside printed.ts, however it is written, but not in printed.ts or on another object (C23)', async () => {
    const reported = [
      "export const bound = vi.spyOn(console, 'error');",
      "vi.spyOn(console, 'warn').mockImplementation(() => {});",
      "export const global = vi.spyOn(globalThis.console, 'log');",
      "export const node = vi.spyOn(global.console, 'log');",
      "export const computed = vi.spyOn(globalThis['console'], 'info');",
      "export const computedNode = vi.spyOn(global['console'], 'debug');",
      'export const named = (method: "debug" | "info") => vi.spyOn(console, method);',
      "export const getter = vi.spyOn(console, 'error', 'get');",
      "export const optional = vi?.spyOn(console, 'warn');",
      "export const parenthesized = vi.spyOn((console), 'error');",
      "export const cast = vi.spyOn(console as Console, 'error');",
      "export const satisfied = vi.spyOn(console satisfies Console, 'error');",
      "export const twice = vi.spyOn(((console as Console)), 'error');",
      "export const nonNull = vi.spyOn(console!, 'error');",
      "export const angle = vi.spyOn(<Console>console, 'error');",
      "export const optionalGlobal = vi.spyOn(globalThis?.console, 'error');",
      "export const windowed = vi.spyOn(window.console, 'error');",
      "export const selfed = vi.spyOn(self.console, 'error');",
      "export const typed = vi.spyOn<Console, 'error'>(console, 'error');",
    ];
    const unreported = [
      "export const emitted = vi.spyOn(process, 'emitWarning');",
      "export const written = vi.spyOn(process.stderr, 'write');",
      "export const logger = vi.spyOn(logs, 'error');",
      "export const similar = vi.spyOn(consoleLike, 'error');",
      "export const other = vi.spyOn(globalThis, 'fetch');",
      "export const quiet = console.error('a line');",
      "export const vitest = vitest.spyOn(console, 'error');",
      'const alias = console;',
      "export const aliased = vi.spyOn(alias, 'error');",
    ];
    const lines = ["import { vi } from 'vitest';", ...reported, ...unreported];
    const expected = reported.map((_, index) => `C23@${index + 2}`);

    expect(await pluginReportsFor(lines, 'probe.test.ts')).toEqual(expected);
    expect(await pluginReportsFor(lines)).toEqual(expected);
    expect(await pluginReportsFor(lines, 'packages/server/test/probe.ts')).toEqual(expected);
    expect(await pluginReportsFor(lines, 'packages/contract/test/printed.ts')).toEqual([]);
  });

  it('report a spy on the console in a file whose path only resembles printed.ts (C23)', async () => {
    const lines = ["import { vi } from 'vitest';", "vi.spyOn(console, 'error');"];

    expect(await pluginReportsFor(lines, 'packages/contract/test/printed.test.ts')).toEqual([
      'C23@2',
    ]);
    expect(await pluginReportsFor(lines, 'packages/server/test/printed.ts')).toEqual(['C23@2']);
    expect(await pluginReportsFor(lines, 'packages/contract/src/printed.ts')).toEqual(['C23@2']);
  });

  it('report a timeout given to a test, a suite or a hook, and vi.setConfig, in a test file, but not other options, a timeout in a body or another file (C30)', async () => {
    const reported = [
      "test('number', () => {}, 10_000);",
      "it('it', () => {}, 5);",
      "suite('suite', () => {}, 5);",
      "test('function', function () {}, 5);",
      "test('body by name', run, 5);",
      "test.concurrent('modifier', () => {}, limit);",
      "test.each([1, 2])('each', () => {}, 5);",
      "test('options', { timeout: 5 }, () => {});",
      "test('options, shorthand', { timeout }, () => {});",
      "test('options, body by name', { retry: 2, timeout: 5 }, run);",
      "describe.concurrent('options, variable', { timeout: limit }, () => {});",
      'beforeAll(() => {}, 5);',
      'beforeEach(() => {}, 9);',
      'afterAll(run, limit);',
      'afterEach(() => {}, 5);',
      'aroundAll(() => {}, 5);',
      'aroundEach(() => {}, 5);',
      'onTestFailed(() => {}, 5);',
      'onTestFinished(() => {}, 4);',
      'vi.setConfig({ testTimeout: 1 });',
    ];
    const unreported = [
      "test('retried', { retry: 2 }, () => {});",
      "test('retried, body by name', { retry: 2 }, run);",
      "test('retried by a variable', { retry: timeout }, () => {});",
      "test('meta', { meta: { timeout: 1 } }, () => {});",
      "test('options by name', options, () => {});",
      "test('options by name, function', options, function () {});",
      "test('in its body', () => { const timeout = 5; vi.waitFor(check, { interval: timeout }); });",
      "signal.addEventListener('abort', () => {}, { once: true });",
      'beforeEach(() => {});',
    ];
    const lines = [
      "import { afterAll, afterEach, aroundAll, aroundEach, beforeAll, beforeEach, describe, it, onTestFailed, onTestFinished, suite, test, vi } from 'vitest';",
      ...reported,
      ...unreported,
    ];

    expect(await pluginReportsFor(lines, 'probe.test.ts')).toEqual(
      reported.map((_, index) => `C30@${index + 2}`),
    );
    expect(await pluginReportsFor(lines, 'probe.fixture.ts')).toEqual([]);
    expect(await pluginReportsFor(lines)).toEqual([]);
  });

  it("report a read of a zod getter derived from a child's own, under walker/ alone (C1)", async () => {
    const lines = [
      'declare const schema: { readonly _zod: Record<string, unknown> };',
      'export const propValues = schema._zod.propValues;',
      'export const values = schema?._zod.values;',
      'export const optin = schema._zod?.optin;',
      'export const optout = schema._zod.optout;',
      'export const def = schema._zod.def;',
      'export const literals = (schema._zod.def as { values: unknown }).values;',
      'export const iterator = [1].values();',
    ];

    expect(await pluginReportsFor(lines, 'walker/probe.ts')).toEqual([
      'C1@2',
      'C1@3',
      'C1@4',
      'C1@5',
    ]);
    expect(await pluginReportsFor(lines)).toEqual([]);
  });

  it('also report such a getter destructured from `_zod` or read from a cast of it, not an alias (C1)', async () => {
    const lines = [
      'declare const schema: { readonly _zod: Record<string, unknown> };',
      'export const { propValues } = schema._zod;',
      'export const { values: renamed } = schema?._zod;',
      'export const { def: kept, optin } = schema._zod;',
      'export const { def } = schema._zod;',
      'export const cast = (schema._zod as { optout: unknown }).optout;',
      'const internals = schema._zod;',
      'export const alias = internals.values;',
    ];

    expect(await pluginReportsFor(lines, 'walker/probe.ts')).toEqual([
      'C1@2',
      'C1@3',
      'C1@4',
      'C1@6',
    ]);
  });

  it('report a web-standard Request built on a signal outside the held one, a cast, `satisfies`, parentheses and `signal: signal` included, but not in the held one’s own file or a test (C1)', async () => {
    const lines = [
      'declare const signal: AbortSignal;',
      "export const shorthand = new Request('http://x/', { signal });",
      "export const named = new Request('http://x/', { signal: signal });",
      "export const cast = new Request('http://x/', { method: 'POST', signal } as RequestInit);",
      "export const plain = new Request('http://x/', { method: 'GET' });",
      "export const bare = new Request('http://x/');",
      "export const nested = new Request('http://x/', { headers: { signal: 'yes' } });",
      "export const satisfied = new Request('http://x/', { signal } satisfies RequestInit);",
      "export const parenthesized = new Request('http://x/', ({ signal }));",
    ];

    expect(await pluginReportsFor(lines)).toEqual(['C1@2', 'C1@3', 'C1@4', 'C1@8', 'C1@9']);
    expect(await pluginReportsFor(lines, 'contract/src/wire/held-request.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'probe.test.ts')).toEqual([]);
  });

  it('report a join on LF in a library package’s source, optional calls and each quote included, but not another separator, the CLI, a test file or the line module (C1)', async () => {
    const lines = [
      'const lines = ["a", "b"];',
      "export const single = lines.join('\\n');",
      'export const double = lines.join("\\n");',
      'export const template = lines.join(`\\n`);',
      "export const optional = lines?.join('\\n');",
      "export const comma = lines.join(', ');",
      "export const empty = lines.join('');",
      "export const spelled = lines.join('\\\\n');",
      "export const space = lines.join(' ');",
    ];

    expect(await pluginReportsFor(lines, 'packages/messaging/src/probe.ts')).toEqual([
      'C1@2',
      'C1@3',
      'C1@4',
      'C1@5',
      'C1@6',
    ]);
    expect(await pluginReportsFor(lines, 'packages/cli/src/probe.ts')).toEqual(['C1@6']);
    expect(await pluginReportsFor(lines, 'packages/messaging/src/probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/contract/src/lines/line.ts')).toEqual(['C1@6']);
    expect(await pluginReportsFor(lines, 'packages/contract/src/lines/joined-names.ts')).toEqual([
      'C1@2',
      'C1@3',
      'C1@4',
      'C1@5',
    ]);
  });

  it('report a join on a comma and a space in any package’s source, the CLI included, each quote, optional calls, a join in a template and one after a map included, but not another separator, a test file, the joinedOf module, the codeListOf module or the fieldValueOf module (C1)', async () => {
    const lines = [
      'const names = ["a", "b"];',
      "export const single = names.join(', ');",
      'export const double = names.join(", ");',
      'export const template = names.join(`, `);',
      "export const optional = names?.join(', ');",
      "export const mapped = names.map((name) => name).join(', ');",
      `export const inTemplate = \`[${'$'}{names.join(', ')}]\`;`,
      "export const bare = names.join(',');",
      "export const empty = names.join('');",
      "export const space = names.join(' ');",
      "export const semicolon = names.join('; ');",
      "export const closed = names.join(' and ');",
    ];
    const reported = ['C1@2', 'C1@3', 'C1@4', 'C1@5', 'C1@6', 'C1@7'];

    expect(await pluginReportsFor(lines, 'packages/messaging/src/probe.ts')).toEqual(reported);
    expect(await pluginReportsFor(lines, 'packages/cli/src/config/probe.ts')).toEqual(reported);
    expect(await pluginReportsFor(lines, 'packages/cli/src/source-text/probe.ts')).toEqual(
      reported,
    );
    expect(await pluginReportsFor(lines, 'packages/messaging/src/probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/contract/src/lines/joined-names.ts')).toEqual(
      [],
    );
    expect(await pluginReportsFor(lines, 'packages/cli/src/source-text/code-lists.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/contract/src/wire/field-values.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'scripts/probe.ts')).toEqual([]);
  });

  it('report a console call in a library package’s source not given one spread of logOf, every method and form, but not the CLI, a test file or the line module (C1)', async () => {
    const lines = [
      'declare const cause: unknown;',
      'declare function logOf(line: string, cause?: unknown): readonly unknown[];',
      "console.error('plain');",
      "console.warn('plain', cause);",
      "console.error(...logOf('spread', cause));",
      "console?.error('optional');",
      "console['error']('computed');",
      "console.log(...logOf('spread'), 'extra');",
      "console.info(logOf('not spread'));",
      'console.debug();',
      "console.warn(...logOf('spread'));",
    ];

    expect(await pluginReportsFor(lines, 'packages/server/src/probe.ts')).toEqual([
      'C1@3',
      'C1@4',
      'C1@6',
      'C1@7',
      'C1@8',
      'C1@9',
      'C1@10',
    ]);
    expect(await pluginReportsFor(lines, 'packages/cli/src/probe.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/server/src/probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/contract/src/lines/line.ts')).toEqual([]);
  });

  it('report an Error’s message that is neither a literal nor unbrokenLineOf or linesTextOf, AggregateError’s and super’s included, but not the CLI, a test file or the line module (C1)', async () => {
    const lines = [
      'declare const text: string;',
      'declare function unbrokenLineOf(line: string): string;',
      'declare function linesTextOf(lines: readonly string[]): string;',
      "export const literal = new Error('plain');",
      'export const bare = new Error(`plain`);',
      'export const unwrapped = new Error(text);',
      'export const called = Error(text);',
      `export const template = new TypeError(\`plain ${'$'}{text}\`);`,
      `export const wrapped = new RangeError(unbrokenLineOf(\`x ${'$'}{text}\`));`,
      'export const joined = new SyntaxError(linesTextOf([text]));',
      'export const aggregate = new AggregateError([], text);',
      "export const aggregated = new AggregateError([], 'ok');",
      "export const concatenated = new URIError('a' + text);",
      'export const multi = new EvalError(',
      '  text,',
      ');',
      'export const reference = new ReferenceError(text);',
      'export class Mine extends Error {',
      '  constructor() {',
      '    super(text);',
      '  }',
      '}',
      'export class Fine extends Error {',
      '  constructor() {',
      "    super('fine');",
      '  }',
      '}',
      'export class Wrapped extends Error {',
      '  constructor() {',
      '    super(unbrokenLineOf(text), { cause: text });',
      '  }',
      '}',
      'export const aggregateCalled = AggregateError([], text);',
      "export const aggregateCalledLiteral = AggregateError([], 'ok');",
    ];

    expect(await pluginReportsFor(lines, 'packages/client/src/probe.ts')).toEqual([
      'C1@6',
      'C1@7',
      'C1@8',
      'C1@11',
      'C1@13',
      'C1@14',
      'C1@17',
      'C1@20',
      'C1@33',
    ]);
    expect(await pluginReportsFor(lines, 'packages/cli/src/probe.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/client/src/probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(lines, 'packages/contract/src/lines/line.ts')).toEqual([]);
  });

  it('report an import, a type import, a require and an import() of node:child_process in a test file and in a file under test/, each form and both module names (C30)', async () => {
    const lines = [
      "import { spawnSync } from 'node:child_process';",
      "import type { ChildProcess } from 'node:child_process';",
      "import * as everything from 'node:child_process';",
      "import { execFile } from 'child_process';",
      "import 'node:child_process';",
      "export const lazily = await import('node:child_process');",
      "export const required = require('node:child_process');",
      "export const lazilyBare = await import('child_process');",
      "export const requiredBare = require('child_process');",
      'export const used = [spawnSync, everything, execFile];',
    ];
    const expected = [
      'C30@1',
      'C30@2',
      'C30@3',
      'C30@4',
      'C30@5',
      'C30@6',
      'C30@7',
      'C30@8',
      'C30@9',
    ];

    expect(await pluginReportsFor(lines, 'probe.test.ts')).toEqual(expected);
    expect(await pluginReportsFor(lines, 'packages/server/test/probe.ts')).toEqual(expected);
    expect(await pluginReportsFor(lines, 'examples/billing-service/test/probe.ts')).toEqual(
      expected,
    );
  });

  it('report a re-export from node:child_process in a file under test/, each form (C30)', async () => {
    const lines = [
      "export { spawn } from 'node:child_process';",
      "export { exec as run } from 'child_process';",
      "export * as processes from 'node:child_process';",
      "export * from 'node:child_process';",
      "export type { ChildProcess } from 'node:child_process';",
    ];

    expect(await pluginReportsFor(lines, 'packages/server/test/probe.ts')).toEqual([
      'C30@1',
      'C30@2',
      'C30@3',
      'C30@4',
      'C30@5',
    ]);
  });

  it('do not report node:child_process in test-process.ts, a file under src/, a test file under packages/cli/, or a string or a module that only resembles it (C30)', async () => {
    const imported = [
      "import { spawn } from 'node:child_process';",
      "export { spawn as run } from 'node:child_process';",
      'export const used = spawn;',
    ];
    const resembling = [
      "export const name = 'node:child_process';",
      "export const names = ['child_process', `node:child_process`];",
      "export const logged = String('node:child_process');",
      "export { lookalike } from 'node:child_processes';",
      "export { local } from './child_process.ts';",
    ];

    expect(await pluginReportsFor(imported, 'packages/messaging/test/test-process.ts')).toEqual([]);
    expect(await pluginReportsFor(imported, 'packages/messaging/src/probe.ts')).toEqual([]);
    expect(await pluginReportsFor(imported, 'scripts/probe.ts')).toEqual([]);
    expect(await pluginReportsFor(imported, 'packages/cli/src/probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(imported, 'packages/cli/test/probe.ts')).toEqual([]);
    expect(await pluginReportsFor(resembling, 'probe.test.ts')).toEqual([]);
    expect(await pluginReportsFor(resembling, 'packages/server/test/probe.ts')).toEqual([]);
  });
});
