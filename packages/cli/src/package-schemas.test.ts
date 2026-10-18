import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { walkSchemas } from '@casitafeliz/loom-contract/internal';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type * as core from 'zod/v4/core';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const bin = join(cliDir, 'src', 'bin.ts');
const tsc = join(packagesDir, '..', 'node_modules', '.bin', 'tsc');
const zodDir = realpathSync(join(cliDir, 'node_modules/zod'));

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function write(folder: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

/** A schema of every node a Snapshot has, used as an Input body and as a Success body. */
const everything = [
  "const tree = z.object({ label: z.string(), get children() { return z.array(tree); } }).meta({ id: 'tree-node' });",
  'const everything = z.object({',
  "  plain: z.string().min(1).max(10).describe('A text'),",
  '  email: z.email(),',
  '  at: z.iso.datetime({ offset: true, precision: 3 }),',
  '  site: z.url({ protocol: /^https$/ }),',
  "  id: z.uuid({ version: 'v4' }),",
  "  digest: z.hash('sha256'),",
  '  color: z.hex(),',
  '  pattern: z.string().regex(/^[a-z]+$/i),',
  '  count: z.int().min(0).lt(100).multipleOf(5),',
  '  ratio: z.number().gt(0).max(1),',
  '  flag: z.boolean(),',
  "  kind: z.literal('order'),",
  "  level: z.enum(['low', 'high']),",
  "  status: openEnum(['pending', 'paid']),",
  '  mixed: z.literal([1, 2, true]),',
  '  strict: z.strictObject({ a: z.string() }),',
  '  record: z.record(z.string(), z.number()),',
  '  list: z.array(z.string()).min(1).max(3),',
  '  tuple: z.tuple([z.string(), z.number()], z.boolean()),',
  '  union: z.union([z.string(), z.number()]),',
  "  payment: openUnion('type', [",
  "    z.object({ type: z.literal('card'), last4: z.string() }),",
  "    z.object({ type: z.literal('transfer'), iban: z.iban() }),",
  '  ]),',
  "  shape: z.discriminatedUnion('kind', [",
  "    z.object({ kind: z.literal('circle'), r: z.number() }),",
  "    z.object({ kind: z.literal('square'), side: z.number() }),",
  '  ]),',
  '  both: z.intersection(z.object({ a: z.string() }), z.record(z.string(), z.string())),',
  '  data: z.json(),',
  '  note: z.string().nullable(),',
  "  optional: z.string().optional().meta({ examples: ['x'] }),",
  '  tree,',
  '});',
];

const service: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: '@org/shapes-service', type: 'module' }),
  'cf-loom.config.ts': lines([
    "import { defineConfig } from '@casitafeliz/loom-cli';",
    "export const config = defineConfig({ scope: '@org' });",
  ]),
  'src/contract/index.ts': lines([
    'import {',
    '  defineContract,',
    '  defineEndpoint,',
    '  defineGroup,',
    '  openEnum,',
    '  openUnion,',
    "} from '@casitafeliz/loom-contract';",
    "import { z } from 'zod';",
    '',
    ...everything,
    'export const echo = defineEndpoint({',
    "  name: 'echo',",
    "  method: 'POST',",
    "  path: '/echo',",
    "  visibility: 'public',",
    "  description: 'Answers what it is sent',",
    '  input: { body: everything },',
    '  success: { status: 200, body: everything },',
    '});',
    "const shapes = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });",
    "export const contract = defineContract({ name: 'shapes-service', groups: [shapes] });",
  ]),
};

/** A value the schema accepts, with an unknown key on the outer object. */
const sample = {
  plain: 'text',
  email: 'a@example.com',
  at: '2026-10-18T09:30:00.000+02:00',
  site: 'https://example.com',
  id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00',
  digest: 'a'.repeat(64),
  color: 'ff00aa',
  pattern: 'Abc',
  count: 15,
  ratio: 0.5,
  flag: true,
  kind: 'order',
  level: 'low',
  status: 'paid',
  mixed: 2,
  strict: { a: 'x' },
  record: { one: 1 },
  list: ['a'],
  tuple: ['a', 1, true, false],
  union: 3,
  payment: { type: 'card', last4: '4242' },
  shape: { kind: 'circle', r: 1 },
  both: { a: 'x' },
  data: { any: [1, null] },
  note: null,
  tree: { label: 'root', children: [{ label: 'leaf', children: [] }] },
  extra: 'dropped',
};

type Endpoint = {
  readonly input: { readonly body: core.$ZodType };
  readonly success: { readonly body: core.$ZodType & { safeParse(value: unknown): Parsed } };
};
type Parsed = { readonly success: boolean; readonly data?: Record<string, unknown> };

let folder = '';
let echo: Endpoint;
let snapshot: {
  readonly defs: Readonly<Record<string, unknown>>;
  readonly endpoints: Readonly<Record<string, { readonly input: { readonly body: unknown } }>>;
};

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'cf-loom-schemas-'));
  const project = join(folder, 'project');
  const out = join(folder, 'contract-shapes-service');
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@casitafeliz/loom-contract'));
  link(cliDir, join(project, 'node_modules/@casitafeliz/loom-cli'));
  link(zodDir, join(project, 'node_modules/zod'));
  write(project, service);
  const packaged = spawnSync(process.execPath, [bin, 'package', '--out', out], {
    cwd: project,
    encoding: 'utf8',
  });
  expect(packaged.stderr).toBe('');
  link(join(packagesDir, 'contract'), join(out, 'node_modules/@casitafeliz/loom-contract'));
  link(zodDir, join(out, 'node_modules/zod'));
  const built = spawnSync(tsc, ['-p', out], { encoding: 'utf8' });
  expect(built.stdout).toBe('');
  const entry = await import(pathToFileURL(join(out, 'dist/index.js')).href);
  echo = entry.contract.endpoints.echo;
  snapshot = JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8'));
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

function read(value: unknown): Parsed {
  return echo.success.body.safeParse(value);
}

describe('cf-loom package: the schemas it writes', () => {
  test('the Input schema walks back to the Snapshot’s node and defs', () => {
    const walked = walkSchemas([{ at: ['body'], schema: echo.input.body }], () => undefined);

    expect(walked.located[0]?.walked).toEqual({
      kind: 'walked',
      value: snapshot.endpoints['POST /echo']?.input.body,
    });
    expect(walked.defs).toEqual(snapshot.defs);
  });

  test('the Success reader reads a value the Contract declares', () => {
    const parsed = read(sample);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.['tree']).toEqual(sample.tree);
  });

  test('the Success reader strips keys it does not know, a strict object’s included', () => {
    const parsed = read({ ...sample, strict: { a: 'x', b: 1 } });

    expect(parsed.data).not.toHaveProperty('extra');
    expect(parsed.data?.['strict']).toEqual({ a: 'x' });
  });

  test('the Success reader reads an unknown Open Enum value as its Unknown case', () => {
    const parsed = read({ ...sample, status: 'refunded' });

    expect(parsed.data?.['status']).toEqual({ unknown: 'refunded' });
  });

  test('the Success reader reads an unknown Open Union variant as its Unknown case, with raw', () => {
    const payment = { type: 'crypto', coin: 'btc' };

    const parsed = read({ ...sample, payment });

    expect(parsed.data?.['payment']).toEqual({ type: { unknown: 'crypto' }, raw: payment });
  });

  test('the Success reader refuses a declared variant that breaks its schema', () => {
    const parsed = read({ ...sample, payment: { type: 'card' } });

    expect(parsed.success).toBe(false);
  });

  test('the Success reader refuses a value that breaks a constraint', () => {
    const parsed = read({ ...sample, plain: '' });

    expect(parsed.success).toBe(false);
  });

  test('the Success reader reads a recursive value nested deeper', () => {
    const tree = {
      label: 'a',
      children: [{ label: 'b', children: [{ label: 'c', children: [] }] }],
    };

    const parsed = read({ ...sample, tree });

    expect(parsed.data?.['tree']).toEqual(tree);
  });
});
