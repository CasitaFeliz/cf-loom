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
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { bin } from '../test/cf-loom-run.ts';
import { aDeadAddress } from '../test/dead-address.ts';
import { everything } from '../test/everything-schema.ts';
import { usage } from '../test/usage.ts';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const projects: string[] = [];
const fixtures: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

afterAll(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

/** A project in a temporary directory, with cf-loom, its handlers and zod installed. */
function makeProject(files: Readonly<Record<string, string>>): string {
  const project = mkdtempSync(join(tmpdir(), 'cf-loom-openapi-'));
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@cf-loom/contract'));
  link(join(packagesDir, 'handlers'), join(project, 'node_modules/@cf-loom/handlers'));
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
  link(realpathSync(join(cliDir, 'node_modules/zod')), join(project, 'node_modules/zod'));
  write(project, files);
  return project;
}

/** A project that the test removes when it ends. */
function aProject(files: Readonly<Record<string, string>>): string {
  const project = makeProject(files);
  projects.push(project);
  return project;
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function write(project: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
}

function cfLoom(project: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Runs the CLI with no npm on PATH and the registry set to an address nothing listens on. */
async function cfLoomOffline(project: string, ...args: string[]) {
  const dead = await aDeadAddress();
  try {
    const emptyPath = mkdtempSync(join(tmpdir(), 'cf-loom-no-npm-'));
    projects.push(emptyPath);
    const env = Object.fromEntries([
      ...Object.entries(process.env),
      ['PATH', emptyPath],
      ['npm_config_registry', dead.url],
    ]);
    const options = { cwd: project, env, encoding: 'utf8' } as const;
    const ran = spawnSync(process.execPath, [bin, ...args], options);
    return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
  } finally {
    dead.release();
  }
}

/** The project after `generate` wrote its Snapshot, which `openapi` reads. */
function generated(project: string): string {
  const ran = cfLoom(project, 'generate');
  if (ran.status !== 0) {
    throw new Error(`generate failed: ${ran.stderr}`);
  }
  return project;
}

function aGeneratedProject(files: Readonly<Record<string, string>>): string {
  return generated(aProject(files));
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

/** The value a document holds after the steps, or `undefined` where a step finds nothing. */
function valueAt(root: unknown, ...steps: readonly string[]): unknown {
  let value = root;
  for (const step of steps) {
    value = typeof value === 'object' && value !== null ? Reflect.get(value, step) : undefined;
  }
  return value;
}

const manifest = JSON.stringify({ name: '@org/orders-service', type: 'module' });

const config = lines([
  "import { defineConfig } from '@cf-loom/cli';",
  '',
  "export const config = defineConfig({ scope: '@org' });",
]);

/** A project around a root file. */
function aRootProject(root: readonly string[]): Readonly<Record<string, string>> {
  return { 'package.json': manifest, 'cf-loom.config.ts': config, 'src/contract/index.ts': lines(root) };
}

/** The imports every fixture root starts with. */
const rootImports = [
  'import {',
  '  defineContract,',
  '  defineEndpoint,',
  '  defineGroup,',
  '  defineGuard,',
  '  defineRejection,',
  '  openEnum,',
  "} from '@cf-loom/contract';",
  "import { z } from 'zod';",
  '',
];

/** The Rejections, the Guard and the Endpoints around `/orders`. */
const orders = [
  "const unauthenticated = defineRejection({ code: 'UNAUTHENTICATED', status: 401, message: 'The API key is missing or unknown' });",
  'const orderLocked = defineRejection({',
  "  code: 'ORDER_LOCKED',",
  '  status: 409,',
  "  message: 'The order can no longer be changed',",
  '  body: z.object({ lockedAt: z.iso.datetime() }),',
  '});',
  "const duplicateOrder = defineRejection({ code: 'DUPLICATE_ORDER', status: 409, message: 'The order exists' });",
  "const orderClosed = defineRejection({ code: 'ORDER_CLOSED', status: 422, message: 'The order is closed' });",
  'export const apiKey = defineGuard({',
  "  name: 'apiKey',",
  "  description: 'An API key per Caller',",
  "  demands: { headers: z.object({ 'x-api-key': z.string().optional() }) },",
  '  qualifier: z.object({ scope: z.string() }),',
  '  context: z.object({ callerId: z.string() }),',
  '  rejections: [unauthenticated],',
  '});',
  'export const createOrder = defineEndpoint({',
  "  name: 'createOrder',",
  "  method: 'POST',",
  "  path: '/orders',",
  "  visibility: 'public',",
  "  description: 'Places a pending order',",
  '  input: { body: z.object({ customerId: z.uuid() }) },',
  '  success: { status: 201, body: z.object({ orderId: z.uuid() }) },',
  '  rejections: [orderLocked, duplicateOrder],',
  '});',
  'export const getOrder = defineEndpoint({',
  "  name: 'getOrder',",
  "  method: 'GET',",
  "  path: '/orders/:orderId',",
  "  visibility: 'internal',",
  "  description: 'One order by id',",
  "  guards: [{ guard: apiKey, qualifier: { scope: 'orders:read' } }],",
  '  input: {',
  '    params: z.object({ orderId: z.uuid() }),',
  '    query: z.object({ expand: z.array(z.string()).optional(), page: z.int().optional() }),',
  "    headers: z.object({ 'x-trace-id': z.string().optional() }),",
  '  },',
  '  success: {',
  '    status: 200,',
  "    headers: z.object({ 'x-state': z.string().describe('The state of the order') }),",
  '    body: z.object({ orderId: z.uuid(), state: z.string() }),',
  '  },',
  '  rejections: [orderLocked],',
  '});',
  'export const deleteOrder = defineEndpoint({',
  "  name: 'deleteOrder',",
  "  method: 'DELETE',",
  "  path: '/orders/:orderId',",
  "  visibility: 'public',",
  "  description: 'Deletes an order',",
  "  lifecycle: 'deprecated',",
  '  input: { params: z.object({ orderId: z.uuid() }) },',
  '  success: { status: 204 },',
  '  rejections: [orderLocked],',
  '});',
  'export const lockOrder = defineEndpoint({',
  "  name: 'lockOrder',",
  "  method: 'PUT',",
  "  path: '/orders/:orderId',",
  "  visibility: 'public',",
  "  description: 'Locks an order',",
  "  lifecycle: 'retired',",
  "  guards: [{ guard: apiKey, qualifier: { scope: 'orders:write' } }],",
  '  input: {',
  '    params: z.object({ orderId: z.uuid() }),',
  '    query: z.object({ force: z.boolean().optional() }),',
  '    body: z.object({ reason: z.string() }),',
  '  },',
  '  success: { status: 200, body: z.object({ locked: z.boolean() }) },',
  '  rejections: [orderClosed],',
  '});',
  "const ordersGroup = defineGroup({ name: 'orders', description: 'Order lifecycle', endpoints: [createOrder, getOrder, deleteOrder, lockOrder] });",
];

/** The Endpoints that hold every node, the regexes and formats, and a description with U+2028. */
const shapes = [
  ...everything,
  'const extras = z.object({',
  '  slug: z.string().regex(/^[a-z-]+$/),',
  '  folded: z.string().regex(/^[a-z]+$/i),',
  '  letters: z.string().regex(/^\\p{L}+$/u),',
  '  at: z.iso.datetime(),',
  '  localAt: z.iso.datetime({ local: true }),',
  '  minuteAt: z.iso.datetime({ precision: -1 }),',
  '  site: z.url(),',
  '  clock: z.iso.time(),',
  "  lockedAt: z.iso.datetime().nullable().describe('When it locked'),",
  "  root: tree.nullable().describe('The root'),",
  "  choice: z.enum(['a', 'b']).nullable(),",
  "  fixed: z.literal('x').nullable(),",
  '  pair: z.tuple([z.string(), z.number()]),',
  '});',
  'export const echo = defineEndpoint({',
  "  name: 'echo',",
  "  method: 'POST',",
  "  path: '/echo',",
  "  visibility: 'public',",
  "  description: 'Answers what it is sent',",
  '  input: { body: everythingIn },',
  '  success: { status: 200, body: everything },',
  '});',
  'export const extra = defineEndpoint({',
  "  name: 'extra',",
  "  method: 'POST',",
  "  path: '/extra',",
  "  visibility: 'public',",
  "  description: 'Takes the extras',",
  '  input: { body: extras },',
  '  success: { status: 200, body: extras },',
  '});',
  'export const proto = defineEndpoint({',
  "  name: 'proto',",
  "  method: 'POST',",
  "  path: '/proto',",
  "  visibility: 'public',",
  "  description: 'Proto',",
  '  input: { body: z.object({ b: z.string().meta({ examples: [JSON.parse(\'{"__proto__":{"a":[1]}}\')] }) }) },',
  '  success: { status: 204 },',
  '});',
  'export const health = defineEndpoint({',
  "  name: 'health',",
  "  method: 'GET',",
  "  path: '/health',",
  "  visibility: 'private',",
  "  description: 'Is up\\u2028and running',",
  '  success: { status: 200, body: z.object({ up: z.boolean() }) },',
  '});',
  "const shapesGroup = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo, extra, proto] });",
  "const infrastructureGroup = defineGroup({ name: 'infrastructure', description: 'Infrastructure', endpoints: [health] });",
];

/** A Service named `orders-service` with an Endpoint of each Visibility, Lifecycle and shape. */
const theService = aRootProject([
  ...rootImports,
  ...orders,
  ...shapes,
  'export const contract = defineContract({',
  "  name: 'orders-service',",
  '  groups: [ordersGroup, shapesGroup, infrastructureGroup],',
  '});',
]);

/** A Service named `orders-service` that declares no Endpoint. */
const aServiceWithoutEndpoints = aRootProject([
  "import { defineContract } from '@cf-loom/contract';",
  '',
  "export const contract = defineContract({ name: 'orders-service' });",
]);

const anApplication = {
  'package.json': manifest,
  'cf-loom.config.ts': config,
  'src/contract/index.ts': lines([
    "import { defineApplication } from '@cf-loom/contract';",
    "export const application = defineApplication({ name: 'orders-service', dependencies: [] });",
  ]),
};

const aDefinitionsPackage = {
  'package.json': manifest,
  'cf-loom.config.ts': config,
  'src/definitions/index.ts': lines([
    "import { defineDefinitions } from '@cf-loom/contract';",
    "export const definitions = defineDefinitions({ name: 'orders-service' });",
  ]),
};

const staleSnapshotLine = 'contract.snapshot.json is missing or out of date: run cf-loom generate';

let fixture = '';
let ran: { status: number | null; stdout: string; stderr: string };
let document: unknown;

beforeAll(() => {
  fixture = makeProject(theService);
  fixtures.push(fixture);
  generated(fixture);
  ran = cfLoom(fixture, 'openapi');
  document = JSON.parse(ran.stdout);
});

describe('cf-loom openapi', () => {
  test('openapi exits 0 and prints nothing on stderr', () => {
    expect([ran.status, ran.stderr]).toEqual([0, '']);
  });

  test('the document is OpenAPI 3.1.1, titled with the Service’s name, at version 0.0.0', () => {
    expect(document).toMatchObject({
      openapi: '3.1.1',
      info: { title: 'orders-service', version: '0.0.0' },
    });
  });

  test('a Service that declares no Endpoint has a document with no path', () => {
    const project = aGeneratedProject(aServiceWithoutEndpoints);

    const empty = cfLoom(project, 'openapi');

    expect(JSON.parse(empty.stdout)).toMatchObject({ paths: {}, tags: [] });
  });
});

describe('cf-loom openapi: what it refuses', () => {
  test('openapi fails when contract.snapshot.json is missing, exit 1, printing no document', () => {
    const project = aProject(theService);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('openapi fails when contract.snapshot.json is out of date, exit 1, printing no document', () => {
    const project = aGeneratedProject(theService);
    write(project, aServiceWithoutEndpoints);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('a root that breaks a rule fails openapi with generate’s lines', () => {
    const project = aProject({
      ...theService,
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'name package-name: A root is named as its package.json, without the scope: billing-service\n',
    });
  });

  test('a contract.snapshot.json that is no JSON is a tooling error', () => {
    const project = aProject({ ...theService, 'contract.snapshot.json': '<<<<<<< HEAD\n' });

    const refused = cfLoom(project, 'openapi');

    expect(refused.status).toBe(3);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): restore it or delete it, then run cf-loom generate\n$/,
    );
  });

  test('an Application has no OpenAPI document, a tooling error', () => {
    const project = aProject(anApplication);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'An Application has no OpenAPI document: only a Service offers Endpoints\n',
    });
  });

  test('a Definitions Package has no OpenAPI document, a tooling error', () => {
    const project = aProject(aDefinitionsPackage);

    const refused = cfLoom(project, 'openapi');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: 'A Definitions Package has no OpenAPI document: only a Service offers Endpoints\n',
    });
  });

  test('openapi takes no argument', () => {
    const project = aProject({});

    const refused = cfLoom(project, 'openapi', 'now');

    expect(refused).toEqual({
      status: 3,
      stdout: '',
      stderr: `openapi takes no argument. ${usage}\n`,
    });
  });

  test.for([
    ['--out', ['--out', 'folder'], 'Only package takes --out'],
    ['--prefix', ['--prefix', 'staging'], 'Only broker-plan takes --prefix'],
    ['--json', ['--json'], 'Only check and broker-plan take --json'],
    ['--force', ['--force'], 'Only publish takes --force'],
    ['--prerelease', ['--prerelease'], 'Only publish takes --prerelease'],
  ] as const)('openapi does not take %s', ([_option, options, message]) => {
    const project = aProject({});

    const refused = cfLoom(project, 'openapi', ...options);

    expect(refused).toEqual({ status: 3, stdout: '', stderr: `${message}. ${usage}\n` });
  });
});
