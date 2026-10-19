import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { walkSchemas } from '@casitafeliz/loom-contract/internal';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
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

/** The text of every file under a folder. */
function filesUnder(folder: string): readonly string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'));
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

/**
 * A schema of every node a Snapshot has, used as a Success body, and with records keyed by an enum
 * or literal, which only Input holds, as an Input body.
 */
const everything = [
  "const tree = z.object({ label: z.string(), get children() { return z.array(tree); } }).meta({ id: 'tree-node' });",
  'const forest = z',
  '  .object({',
  '    inner: z.object({ a: z.string() }),',
  "    status: openEnum(['a', \"it's\"]),",
  "    pick: z.discriminatedUnion('the-type', [z.object({ 'the-type': z.literal('x') })]),",
  '    note: z.string().nullable(),',
  '    maybe: z.string().optional(),',
  '    tuple: z.tuple([z.string()], z.number()),',
  '    tree,',
  '    get parent() {',
  "      return forest.optional().describe('the parent');",
  '    },',
  '  })',
  "  .meta({ id: 'forest' });",
  'const leaf = z',
  "  .object({ type: z.literal('leaf'), get parent() { return node.optional(); } })",
  "  .meta({ id: 'leaf' });",
  "const node = z.discriminatedUnion('type', [leaf, z.object({ type: z.literal('branch') })]);",
  'const twig = z',
  "  .object({ kind: z.literal('twig'), get up() { return stem.optional(); } })",
  "  .meta({ id: 'twig' });",
  "const stem = z.discriminatedUnion('kind', [twig, z.object({ kind: z.literal('stem') })]);",
  'const bough = z',
  '  .object({',
  '    get list() {',
  "      return z.array(z.lazy(() => bough).describe('In a list'));",
  '    },',
  '    get named() {',
  "      return z.record(z.string(), z.lazy(() => bough).describe('By name'));",
  '    },',
  '  })',
  "  .meta({ id: 'bough' });",
  'const everything = z.object({',
  '  plain: z.string().min(1).max(10).describe("It\'s a text"),',
  '  email: z.email(),',
  '  at: z.iso.datetime({ offset: true, precision: 3 }),',
  '  site: z.url({ protocol: /^https$/ }),',
  "  id: z.uuid({ version: 'v4' }),",
  "  digest: z.hash('sha256'),",
  "  digest2: z.hash('md5', { enc: 'base64' }),",
  '  scores: z.record(z.string().min(2), z.number()),',
  "  rooted: z.object({ tree: tree.optional().describe('The root') }).required(),",
  '  forest,',
  '  node,',
  '  stem,',
  '  color: z.hex(),',
  '  pattern: z.string().regex(/^[a-z]+$/i),',
  '  count: z.int().min(0).lt(100).multipleOf(5),',
  '  ratio: z.number().gt(0).max(1),',
  '  flag: z.boolean(),',
  "  kind: z.literal('order'),",
  "  level: z.enum(['low', 'high']),",
  "  status: openEnum(['pending', 'paid']),",
  '  mixed: z.literal([1, 2, true]),',
  '  inner: z.object({ a: z.string() }),',
  '  record: z.record(z.string(), z.number()),',
  '  list: z.array(z.string()).min(1).max(3),',
  '  tuple: z.tuple([z.string(), z.number()], z.boolean()),',
  '  union: z.union([z.string(), z.number()]),',
  '  payment: z.object({',
  "    type: openEnum(['card', 'transfer']),",
  '    last4: z.string().optional(),',
  '    iban: z.iban().optional(),',
  '  }),',
  "  shape: z.discriminatedUnion('kind', [",
  "    z.object({ kind: z.literal('circle'), r: z.number() }),",
  "    z.object({ kind: z.literal('square'), side: z.number() }),",
  '  ]),',
  '  both: z.intersection(z.object({ a: z.string() }), z.record(z.string(), z.string())),',
  '  data: z.json(),',
  '  note: z.string().nullable(),',
  "  optional: z.string().optional().meta({ examples: ['x'] }),",
  '  tree,',
  '  bough,',
  '});',
  'const twin = z',
  '  .object({',
  '    get kids() {',
  "      return z.partialRecord(z.enum(['l', 'r']), z.lazy(() => twin).describe('A child'));",
  '    },',
  '  })',
  "  .meta({ id: 'twin' });",
  'const everythingIn = everything.extend({',
  '  twin: twin.optional(),',
  "  keyed: z.record(z.enum(['a', 'b']), z.number()),",
  "  partial: z.partialRecord(z.enum(['a', 'b']), z.number()),",
  "  single: z.record(z.literal('a'), z.number()),",
  '});',
];

/** An Endpoint with two params, a query, Success headers, a Guard listing another, and a Rejection body. */
const richEndpoint = [
  "export const base = defineGuard({ name: 'base', description: 'Base', context: z.object({ userId: z.string() }) });",
  "const denied = defineRejection({ code: 'DENIED', status: 403, message: 'Denied' });",
  'export const session = defineGuard({',
  "  name: 'session',",
  "  description: 'Session',",
  '  guards: [base],',
  '  demands: { query: z.object({ token: z.string() }) },',
  '  context: z.object({ sessionId: z.uuid() }),',
  '  rejections: [denied],',
  '});',
  'const goneForGood = defineRejection({',
  "  code: 'GONE_FOR_GOOD',",
  '  status: 410,',
  '  message: "It\'s gone",',
  "  body: z.object({ reason: openEnum(['moved']) }),",
  '});',
  'export const rich = defineEndpoint({',
  "  name: 'rich',",
  "  method: 'GET',",
  "  path: '/orders/:orderId/items/:itemId',",
  "  visibility: 'internal',",
  "  description: 'Rich',",
  '  guards: [base, session],',
  '  input: {',
  '    params: z.object({ orderId: z.string(), itemId: z.string() }),',
  '    query: z.object({ page: z.number().optional() }),',
  '  },',
  "  success: { status: 200, headers: z.object({ 'x-state': openEnum(['ok']) }), body: z.object({}) },",
  '  rejections: [goneForGood],',
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
    '  defineGuard,',
    '  defineRejection,',
    '  openEnum,',
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
    '  input: { body: everythingIn },',
    '  success: { status: 200, body: everything },',
    '});',
    ...richEndpoint,
    'export const proto = defineEndpoint({',
    "  name: 'proto',",
    "  method: 'POST',",
    "  path: '/proto',",
    "  visibility: 'public',",
    "  description: 'Proto',",
    '  input: { body: z.object({ b: z.string().meta({ examples: [JSON.parse(\'{"__proto__":{"a":[1]}}\')] }) }) },',
    '  success: { status: 204 },',
    '});',
    "const shapes = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo, rich, proto] });",
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
  digest2: `${'a'.repeat(22)}==`,
  scores: { ab: 1 },
  rooted: { tree: { label: 'root', children: [] } },
  forest: {
    inner: { a: 'x' },
    status: 'a',
    pick: { 'the-type': 'x' },
    note: null,
    tuple: ['a', 1, 2],
    tree: { label: 'root', children: [] },
    parent: {
      inner: { a: 'y' },
      status: "it's",
      pick: { 'the-type': 'x' },
      note: 'n',
      maybe: 'm',
      tuple: ['b'],
      tree: { label: 'leaf', children: [] },
    },
  },
  node: { type: 'leaf', parent: { type: 'branch' } },
  stem: { kind: 'twig', up: { kind: 'stem' } },
  color: 'ff00aa',
  pattern: 'Abc',
  count: 15,
  ratio: 0.5,
  flag: true,
  kind: 'order',
  level: 'low',
  status: 'paid',
  mixed: 2,
  inner: { a: 'x' },
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
  bough: { list: [], named: {} },
  extra: 'dropped',
};

type Reader = core.$ZodType & { safeParse(value: unknown): Parsed };
type Endpoint = {
  readonly input: { readonly body: core.$ZodType };
  readonly success: { readonly body: Reader & { readonly shape: Record<string, core.$ZodType> } };
};
type RichGuard = { readonly context: core.$ZodType; readonly guards?: readonly unknown[] };
type Rich = {
  readonly path: string;
  readonly description: string;
  readonly guards: readonly RichGuard[];
  readonly input: { readonly query: core.$ZodType };
  readonly success: { readonly headers: Reader };
  readonly rejections: readonly {
    readonly code: string;
    readonly message: string;
    readonly body: Reader;
  }[];
};
type Parsed = { readonly success: boolean; readonly data?: Record<string, unknown> };

let folder = '';
let echo: Endpoint;
let entrySnapshot: unknown;
let rich: Rich;
let proto: { readonly input: { readonly body: core.$ZodType } };
let snapshot: {
  readonly defs: Readonly<Record<string, unknown>>;
  readonly endpoints: Readonly<
    Record<string, { readonly input: { readonly body: unknown; readonly query: unknown } }>
  >;
  readonly guards: Readonly<Record<string, { readonly context: unknown }>>;
};

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'cf-loom-schemas-'));
  const project = join(folder, 'project');
  const out = join(folder, 'contract-shapes-service');
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@casitafeliz/loom-contract'));
  link(cliDir, join(project, 'node_modules/@casitafeliz/loom-cli'));
  link(zodDir, join(project, 'node_modules/zod'));
  write(project, service);
  spawnSync(process.execPath, [bin, 'generate'], { cwd: project, encoding: 'utf8' });
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
  entrySnapshot = entry.snapshot;
  rich = entry.contract.endpoints.rich;
  proto = entry.contract.endpoints.proto;
  snapshot = JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8'));
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

function read(value: unknown): Parsed {
  return echo.success.body.safeParse(value);
}

/** The node a schema walks back to, so a test compares it with the Snapshot's. */
function walkedOf(schema: core.$ZodType): unknown {
  return walkSchemas([{ at: ['body'], schema }], () => undefined).located[0]?.walked;
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

  test('the Success reader strips keys it does not know, a nested object’s included', () => {
    const parsed = read({ ...sample, inner: { a: 'x', b: 1 } });

    expect(parsed.data).not.toHaveProperty('extra');
    expect(parsed.data?.['inner']).toEqual({ a: 'x' });
  });

  test('the Success reader reads an unknown Open Enum value as its Unknown case', () => {
    const parsed = read({ ...sample, status: 'refunded' });

    expect(parsed.data?.['status']).toEqual({ unknown: 'refunded' });
  });

  test('the Success reader reads a variant typed by an Open Enum it does not know as its Unknown case', () => {
    const parsed = read({ ...sample, payment: { type: 'crypto', coin: 'btc' } });

    expect(parsed.data?.['payment']).toEqual({ type: { unknown: 'crypto' } });
  });

  test('the Success reader refuses a discriminated union variant it does not know', () => {
    const parsed = read({ ...sample, shape: { kind: 'triangle', side: 1 } });

    expect(parsed.success).toBe(false);
  });

  test('the Success reader refuses a declared variant that breaks its schema', () => {
    const parsed = read({ ...sample, shape: { kind: 'circle' } });

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
  test.each([
    ['an array longer than its bounds', { list: ['a', 'b', 'c', 'd'] }],
    ['a number at an exclusive bound', { ratio: 0 }],
    ['a number past its upper bound', { count: 100 }],
    ['a number that is not a multiple', { count: 7 }],
    ['a value outside a closed enum', { level: 'mid' }],
    ['an intersection whose right item is broken', { both: { a: 'x', n: 1 } }],
    ['a hash of the wrong encoding', { digest2: 'a'.repeat(32) }],
    ['a record key that breaks its constraint', { scores: { a: 1 } }],
    ['a required recursive field left out', { rooted: {} }],
  ])('the Success reader refuses %s', (_name, change) => {
    const parsed = read({ ...sample, ...change });

    expect(parsed.success).toBe(false);
  });

  test('the Success reader keeps the annotations the Snapshot records', () => {
    const plain = echo.success.body.shape['plain'];

    expect(plain === undefined ? undefined : z.globalRegistry.get(plain)).toEqual({
      description: "It's a text",
    });
  });

  test('the Input schema refuses a key outside an enum-keyed record’s keys, as the Service does', () => {
    const records = { keyed: { a: 1, b: 2, c: 3 }, partial: { a: 1 }, single: { a: 1 } };

    const parsed = echo.input.body['~standard'].validate({ ...sample, ...records });

    expect(parsed).toMatchObject({
      issues: [{ code: 'unrecognized_keys', keys: ['c'], path: ['keyed'] }],
    });
  });

  test('no file of the package declares a strict object', () => {
    const written = filesUnder(join(folder, 'contract-shapes-service', 'src'));

    expect(written.filter((text) => text.includes('strictObject'))).toEqual([]);
  });

  test('no file of the package or of generate reads an unknown variant', () => {
    const generated = ['readers.generated.ts', 'handlers.generated.ts'].map((file) =>
      readFileSync(join(folder, 'project', 'src', file), 'utf8'),
    );
    const written = [...filesUnder(join(folder, 'contract-shapes-service', 'src')), ...generated];

    expect(written.filter((text) => /openUnion|\braw\b/.test(text))).toEqual([]);
  });

  test('a recursive def reads its Unknown cases, optional, nullable and tuple fields, and another def', () => {
    const forest = {
      ...sample.forest,
      inner: { a: 'x', b: 2 },
      status: 'new',
      pick: { 'the-type': 'x', more: 1 },
    };

    const parsed = read({ ...sample, forest });

    expect(parsed.data?.['forest']).toEqual({
      ...sample.forest,
      inner: { a: 'x' },
      status: { unknown: 'new' },
      pick: { 'the-type': 'x' },
    });
  });

  test('a discriminated union with a recursive variant refuses a variant it does not know', () => {
    const parsed = read({ ...sample, node: { type: 'leaf', parent: { type: 'vine' } } });

    expect(parsed.success).toBe(false);
  });

  test('a discriminated union with a recursive variant reads a nested value', () => {
    const parsed = read(sample);

    expect(parsed.data?.['stem']).toEqual(sample.stem);
  });

  test('the entry’s snapshot is snapshot.json, a __proto__ key in an example included', () => {
    expect(isDeepStrictEqual(entrySnapshot, snapshot)).toBe(true);
    expect(JSON.stringify(entrySnapshot)).toContain('"__proto__"');
  });

  test('an example holding a __proto__ key walks back to the Snapshot’s node', () => {
    expect(walkedOf(proto.input.body)).toEqual({
      kind: 'walked',
      value: snapshot.endpoints['POST /proto']?.input.body,
    });
  });
});

describe('cf-loom package: an exported Endpoint’s slots', () => {
  test('it lists only its own Rejections, its Guards’ left to them', () => {
    expect(rich.rejections.map(({ code }) => code)).toEqual(['GONE_FOR_GOOD']);
  });

  test('its path puts its params back in order', () => {
    expect(rich.path).toBe('/orders/:orderId/items/:itemId');
  });

  test('its description and its Rejection’s message are as declared', () => {
    expect([rich.description, rich.rejections[0]?.message]).toEqual(['Rich', "It's gone"]);
  });

  test('its Success headers are a reader', () => {
    const parsed = rich.success.headers.safeParse({ 'x-state': 'new', other: 'x' });

    expect(parsed.data).toEqual({ 'x-state': { unknown: 'new' } });
  });

  test('its Rejection’s body is a reader', () => {
    const parsed = rich.rejections[0]?.body.safeParse({ reason: 'lost' });

    expect(parsed?.data).toEqual({ reason: { unknown: 'lost' } });
  });

  test('its Guard lists the Guard it reads, as attached', () => {
    expect(rich.guards[1]?.guards?.[0]).toBe(rich.guards[0]);
  });

  test('its Guard’s Context walks back to the Snapshot’s node', () => {
    const context = rich.guards[1]?.context;

    expect(context === undefined ? undefined : walkedOf(context)).toEqual({
      kind: 'walked',
      value: snapshot.guards['session']?.context,
    });
  });

  test('its query, the Guard’s demand merged, walks back to the Snapshot’s node', () => {
    expect(walkedOf(rich.input.query)).toEqual({
      kind: 'walked',
      value: snapshot.endpoints['GET /orders/{}/items/{}']?.input.query,
    });
  });
});
