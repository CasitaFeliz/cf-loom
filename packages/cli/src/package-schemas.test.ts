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
import { encodedValueOf, walkSchemas } from '@cf-loom/contract/internal';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { everything } from '../test/everything-schema.ts';

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

/** An Endpoint answering a union whose first option keeps a key the second one would drop. */
const overlappingUnionEndpoint = [
  'export const overlap = defineEndpoint({',
  "  name: 'overlap',",
  "  method: 'GET',",
  "  path: '/overlap',",
  "  visibility: 'public',",
  "  description: 'Overlap',",
  '  success: {',
  '    status: 200,',
  '    body: z.union([',
  '      z.object({ b: z.string(), c: z.number() }),',
  '      z.object({ b: z.string(), a: z.string().optional() }),',
  '    ]),',
  '  },',
  '});',
];

const service: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: '@org/shapes-service', type: 'module' }),
  'cf-loom.config.ts': lines([
    "import { defineConfig } from '@cf-loom/cli';",
    "export const config = defineConfig({ scope: '@org' });",
  ]),
  'src/contract/index.ts': lines([
    'import {',
    '  defineContract,',
    '  defineEndpoint,',
    '  defineEvent,',
    '  defineGroup,',
    '  defineGuard,',
    '  defineRejection,',
    '  openEnum,',
    "} from '@cf-loom/contract';",
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
    ...richEndpoint,
    ...overlappingUnionEndpoint,
    'export const proto = defineEndpoint({',
    "  name: 'proto',",
    "  method: 'POST',",
    "  path: '/proto',",
    "  visibility: 'public',",
    "  description: 'Proto',",
    '  input: { body: z.object({ b: z.string().meta({ examples: [JSON.parse(\'{"__proto__":{"a":[1]}}\')] }) }) },',
    '  success: { status: 204 },',
    '});',
    "const shaped = defineEvent({ name: 'Shaped', version: 1, visibility: 'internal', description: 'Shaped', body: everything });",
    "const shapes = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo, rich, overlap, proto], events: [shaped] });",
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
  partialScores: { any: 1 },
  optionals: {},
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
type Shaped = {
  readonly kind: string;
  readonly name: string;
  readonly version: number;
  readonly visibility: string;
  readonly description: string;
  readonly body: Reader & { readonly shape: Record<string, core.$ZodType> };
};

let folder = '';
let echo: Endpoint;
let entrySnapshot: unknown;
let rich: Rich;
let proto: { readonly input: { readonly body: core.$ZodType } };
let overlap: { readonly success: { readonly body: Reader } };
let shaped: Shaped;
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
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@cf-loom/contract'));
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
  link(zodDir, join(project, 'node_modules/zod'));
  write(project, service);
  spawnSync(process.execPath, [bin, 'generate'], { cwd: project, encoding: 'utf8' });
  const packaged = spawnSync(process.execPath, [bin, 'package', '--out', out], {
    cwd: project,
    encoding: 'utf8',
  });
  expect(packaged.stderr).toBe('');
  link(join(packagesDir, 'contract'), join(out, 'node_modules/@cf-loom/contract'));
  link(zodDir, join(out, 'node_modules/zod'));
  const built = spawnSync(tsc, ['-p', out], { encoding: 'utf8' });
  expect(built.stdout).toBe('');
  const entry = await import(pathToFileURL(join(out, 'dist/index.js')).href);
  echo = entry.contract.endpoints.echo;
  entrySnapshot = entry.snapshot;
  rich = entry.contract.endpoints.rich;
  proto = entry.contract.endpoints.proto;
  overlap = entry.contract.endpoints.overlap;
  shaped = entry.contract.events.shapedV1;
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

  test('the Reader of a union reads with the first option that parses, as the Provider’s schema does', () => {
    const parsed = overlap.success.body.safeParse({ b: 'x', c: 1 });

    expect(parsed.data).toEqual({ b: 'x', c: 1 });
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

  test('the Success reader writes an Unknown case back as its text, and refuses one holding a declared value', () => {
    const status = echo.success.body.shape['status'];
    if (status === undefined) {
      throw new Error('The fixture has no status');
    }

    const written = [
      encodedValueOf(status, { unknown: 'refunded' }),
      encodedValueOf(status, { unknown: 'paid' }),
    ];

    expect(written).toMatchObject([
      { kind: 'value', value: 'refunded' },
      { kind: 'issues', issues: [{ path: [], code: 'invalid_value' }] },
    ]);
  });

  test('a recursive def’s reader writes its Unknown cases back as their text', () => {
    const forest = echo.success.body.shape['forest'];
    if (forest === undefined) {
      throw new Error('The fixture has no forest');
    }
    const read = { ...sample.forest, status: { unknown: 'new' } };

    const written = encodedValueOf(forest, read);

    expect(written).toEqual({ kind: 'value', value: { ...sample.forest, status: 'new' } });
  });

  test('every Open Enum reader of the package and of generate is written as loom.openEnumReader', () => {
    const generated = readFileSync(join(folder, 'project', 'src', 'readers.generated.ts'), 'utf8');
    const written = [...filesUnder(join(folder, 'contract-shapes-service', 'src')), generated];

    expect(written.filter((text) => text.includes('.transform('))).toEqual([]);
    expect(written.filter((text) => text.includes('loom.openEnumReader(['))).not.toEqual([]);
  });

  test('a one-value Open Enum is written as an Open Enum reader, not as a literal', () => {
    const written = filesUnder(join(folder, 'contract-shapes-service', 'src')).join('\n');

    expect(written).toContain("loom.openEnumReader(['ok'])");
    expect(written).not.toContain("z.literal('ok')");
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

describe('cf-loom package: an exported Event’s body', () => {
  test('it reads a value the Contract declares, unknown keys stripped', () => {
    const parsed = shaped.body.safeParse(sample);

    expect(parsed.data?.['tree']).toEqual(sample.tree);
    expect(parsed.data).not.toHaveProperty('extra');
  });

  test('it reads an unknown Open Enum value as its Unknown case', () => {
    const parsed = shaped.body.safeParse({ ...sample, status: 'refunded' });

    expect(parsed.data?.['status']).toEqual({ unknown: 'refunded' });
  });

  test('it writes an Unknown case back as its text and refuses one holding a declared value, as fakeEvent writes a body', () => {
    const read = { ...sample, extra: undefined, status: { unknown: 'refunded' } };

    const written = [
      encodedValueOf(shaped.body, read),
      encodedValueOf(shaped.body, { ...read, status: { unknown: 'paid' } }),
    ];

    expect(written).toMatchObject([
      { kind: 'value', value: { status: 'refunded' } },
      { kind: 'issues', issues: [{ path: ['status'], code: 'invalid_value' }] },
    ]);
  });

  test('it refuses a value that breaks a constraint', () => {
    const parsed = shaped.body.safeParse({ ...sample, plain: '' });

    expect(parsed.success).toBe(false);
  });

  test('it refuses a discriminated union variant it does not know', () => {
    const parsed = shaped.body.safeParse({ ...sample, shape: { kind: 'triangle', side: 1 } });

    expect(parsed.success).toBe(false);
  });

  test('its name, version, Visibility and description are as declared, and its kind is event', () => {
    const { kind, name, version, visibility, description } = shaped;

    expect({ kind, name, version, visibility, description }).toEqual({
      kind: 'event',
      name: 'Shaped',
      version: 1,
      visibility: 'internal',
      description: 'Shaped',
    });
  });
});
