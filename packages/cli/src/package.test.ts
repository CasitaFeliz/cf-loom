import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
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
import { afterEach, describe, expect, test } from 'vitest';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const bin = join(cliDir, 'src', 'bin.ts');
const tsc = join(packagesDir, '..', 'node_modules', '.bin', 'tsc');
const zodDir = realpathSync(join(cliDir, 'node_modules/zod'));
const zodVersion: string = JSON.parse(readFileSync(join(zodDir, 'package.json'), 'utf8')).version;
const contractVersion: string = JSON.parse(
  readFileSync(join(packagesDir, 'contract', 'package.json'), 'utf8'),
).version;
const folders: string[] = [];

/** Root may write in any folder, so a permission test means nothing when run as root. */
const isRoot = process.getuid?.() === 0;

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'cf-loom-package-'));
  folders.push(folder);
  return folder;
}

/** Links only the two peers of a Contract Package into a folder's `node_modules`. */
function linkPeers(folder: string): void {
  link(join(packagesDir, 'contract'), join(folder, 'node_modules/@cf-loom/contract'));
  link(zodDir, join(folder, 'node_modules/zod'));
}

/** A project in a temporary directory, with cf-loom and zod installed and the files given. */
function aProject(files: Readonly<Record<string, string>>): string {
  const project = aFolder();
  linkPeers(project);
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
  write(project, files);
  return project;
}

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

function read(folder: string, path: string): string {
  return readFileSync(join(folder, path), 'utf8');
}

function filesIn(folder: string): readonly string[] {
  const files = readdirSync(folder, { recursive: true, encoding: 'utf8' });
  return files.filter((file) => !file.startsWith('node_modules')).sort();
}

function cfLoom(project: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Runs `package` where the committed Snapshot is up to date, as `package` requires. */
function packageIn(project: string, ...args: string[]) {
  cfLoom(project, 'generate');
  return cfLoom(project, 'package', ...args);
}

function typeCheck(project: string) {
  const ran = spawnSync(tsc, ['-p', project], { encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout };
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

/** A value with every object's keys sorted, as the canonical form writes them. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortedKeys);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const keys = Object.keys(value).sort();
  return Object.fromEntries(keys.map((key) => [key, sortedKeys(Reflect.get(value, key))]));
}

const config = lines([
  "import { defineConfig } from '@cf-loom/cli';",
  "export const config = defineConfig({ scope: '@org' });",
]);

/** `@org/definitions`, installed as built JavaScript: a Guard with a Qualifier and a shared schema. */
const definitions: Readonly<Record<string, string>> = {
  'node_modules/@org/definitions/package.json': JSON.stringify({
    name: '@org/definitions',
    version: '4.2.0',
    type: 'module',
    exports: './index.js',
  }),
  'node_modules/@org/definitions/index.js': lines([
    "import { defineDefinitions, defineGuard, defineRejection } from '@cf-loom/contract';",
    "import { z } from 'zod';",
    'export const money = z.object({ amount: z.int(), currency: z.string() });',
    "export const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'No' });",
    'export const userToken = defineGuard({',
    "  name: 'userToken',",
    "  description: 'A signed-in user',",
    '  demands: { headers: z.object({ authorization: z.string() }) },',
    '  context: z.object({ userId: z.string() }),',
    '});',
    'export const permission = defineGuard({',
    "  name: 'permission',",
    "  description: 'Every listed permission',",
    '  guards: [userToken],',
    "  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),",
    '  rejections: [forbidden],',
    '});',
    'export const definitions = defineDefinitions({',
    "  name: 'definitions',",
    '  guards: [userToken, permission],',
    '  schemas: { money },',
    '  rejections: [forbidden],',
    '});',
  ]),
};

/**
 * A Service with a Public Endpoint attaching the Definitions Package's Guards, a Deprecated
 * Internal one, a Private one with its own Guard, code and recursive schema, and a Retired one;
 * a Deprecated and an Active Internal Event, a Private and a Retired one, a Command and a
 * Subscription.
 */
const service: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: '@org/orders-service', type: 'module' }),
  'cf-loom.config.ts': config,
  ...definitions,
  'src/contract/index.ts': lines([
    'import {',
    '  defineCommand,',
    '  defineContract,',
    '  defineEndpoint,',
    '  defineEvent,',
    '  defineGroup,',
    '  defineGuard,',
    '  defineRejection,',
    '  defineSubscription,',
    '  notFound,',
    '  openEnum,',
    "} from '@cf-loom/contract';",
    "import { definitions, money, permission, userToken } from '@org/definitions';",
    "import { z } from 'zod';",
    '',
    'export const orderLocked = defineRejection({',
    "  code: 'ORDER_LOCKED',",
    '  status: 409,',
    "  message: 'Locked',",
    '  body: z.object({ lockedAt: z.iso.datetime() }),',
    '});',
    "export const adminOnly = defineRejection({ code: 'ADMIN_ONLY', status: 403, message: 'Admins' });",
    'export const apiKey = defineGuard({',
    "  name: 'apiKey',",
    "  description: 'An API key',",
    "  demands: { headers: z.object({ 'x-api-key': z.string() }) },",
    '  rejections: [adminOnly],',
    '});',
    'export const category = z.object({',
    '  name: z.string(),',
    '  get children() {',
    '    return z.array(category);',
    '  },',
    "}).meta({ id: 'category' });",
    'export const getOrder = defineEndpoint({',
    "  name: 'getOrder',",
    "  method: 'GET',",
    "  path: '/orders/:orderId',",
    "  visibility: 'public',",
    "  description: 'One order',",
    "  guards: [userToken, { guard: permission, qualifier: ['orders:read'] }],",
    '  input: { params: z.object({ orderId: z.uuid() }) },',
    '  success: {',
    '    status: 200,',
    "    body: z.object({ id: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),",
    '  },',
    '  rejections: [notFound, orderLocked],',
    '});',
    'export const listOrders = defineEndpoint({',
    "  name: 'listOrders',",
    "  method: 'GET',",
    "  path: '/orders',",
    "  visibility: 'internal',",
    "  description: 'Every order',",
    "  lifecycle: 'deprecated',",
    '  input: { query: z.object({ page: z.number().optional() }) },',
    '  success: { status: 200, body: z.object({ ids: z.array(z.uuid()) }) },',
    '});',
    'export const adminOrder = defineEndpoint({',
    "  name: 'adminOrder',",
    "  method: 'GET',",
    "  path: '/admin/orders',",
    "  visibility: 'private',",
    "  description: 'For admins',",
    '  guards: [apiKey],',
    '  success: { status: 200, body: category },',
    '});',
    'export const oldOrders = defineEndpoint({',
    "  name: 'oldOrders',",
    "  method: 'GET',",
    "  path: '/old-orders',",
    "  visibility: 'public',",
    "  description: 'Gone',",
    "  lifecycle: 'retired',",
    '  success: { status: 200, body: z.object({}) },',
    '});',
    'const orders = defineGroup({',
    "  name: 'orders',",
    "  description: 'Orders',",
    '  endpoints: [getOrder, listOrders, adminOrder, oldOrders],',
    '});',
    'export const orderPlacedV1 = defineEvent({',
    "  name: 'OrderPlaced',",
    '  version: 1,',
    "  visibility: 'internal',",
    "  description: 'An order was placed',",
    "  lifecycle: 'deprecated',",
    '  body: z.object({ orderId: z.uuid() }),',
    '});',
    'export const orderPlacedV2 = defineEvent({',
    "  name: 'OrderPlaced',",
    '  version: 2,',
    "  visibility: 'internal',",
    "  description: 'An order was placed, with its total',",
    "  body: z.object({ orderId: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),",
    '});',
    'export const stockReserved = defineEvent({',
    "  name: 'StockReserved',",
    '  version: 1,',
    "  visibility: 'private',",
    "  description: 'Stock was reserved',",
    '  body: z.object({ sku: z.string() }),',
    '});',
    'export const orderPurged = defineEvent({',
    "  name: 'OrderPurged',",
    '  version: 1,',
    "  visibility: 'internal',",
    "  description: 'An order was purged',",
    "  lifecycle: 'retired',",
    '  body: z.object({ purgedId: z.uuid() }),',
    '});',
    'export const chargeCard = defineCommand({',
    "  name: 'ChargeCard',",
    '  version: 1,',
    "  description: 'Charge a card',",
    '  body: z.object({ cardToken: z.string() }),',
    '});',
    "export const auditPlaced = defineSubscription({ name: 'audit-placed', event: orderPlacedV2 });",
    'export const contract = defineContract({',
    "  name: 'orders-service',",
    '  definitions: [definitions],',
    '  groups: [orders],',
    '  events: [orderPlacedV1, orderPlacedV2, stockReserved, orderPurged],',
    '  commands: [chargeCard],',
    '  subscriptions: [auditPlaced],',
    '});',
  ]),
};

/** A Service whose one Endpoint, `ping`, holds the declarations, rejections and body given. */
function withDeclarations(
  declarations: readonly string[],
  rejections: string,
  body = 'z.object({})',
): Readonly<Record<string, string>> {
  return {
    'package.json': JSON.stringify({ name: '@org/orders-service', type: 'module' }),
    'cf-loom.config.ts': config,
    'src/contract/index.ts': lines([
      "import { defineContract, defineEndpoint, defineGroup, defineRejection } from '@cf-loom/contract';",
      "import { z } from 'zod';",
      ...declarations,
      'export const ping = defineEndpoint({',
      "  name: 'ping',",
      "  method: 'GET',",
      "  path: '/ping',",
      "  visibility: 'public',",
      "  description: 'Ping',",
      `  success: { status: 200, body: ${body} },`,
      `  ${rejections}`,
      '});',
      "const pings = defineGroup({ name: 'pings', description: 'Pings', endpoints: [ping] });",
      "export const contract = defineContract({ name: 'orders-service', groups: [pings] });",
    ]),
  };
}

/** A Service as `withDeclarations` writes it, its root also listing the Events given. */
function withEvents(
  declarations: readonly string[],
  events: string,
  body = 'z.object({})',
): Readonly<Record<string, string>> {
  const files = withDeclarations(declarations, '', body);
  const root = (files['src/contract/index.ts'] ?? '')
    .replace('defineRejection }', 'defineRejection, defineEvent }')
    .replace('groups: [pings] }', `groups: [pings], events: [${events}] }`);
  return { ...files, 'src/contract/index.ts': root };
}

/** Rewrites one file of a folder from what it holds. */
function edit(folder: string, path: string, change: (text: string) => string): void {
  write(folder, { [path]: change(read(folder, path)) });
}

/** A Contract Package of a Service with one Public Endpoint, `ping`, built in a folder of its own. */
function aProviderPackage(name: string): string {
  const project = aProject({
    ...withDeclarations([], ''),
    'package.json': JSON.stringify({ name: `@org/${name}`, type: 'module' }),
  });
  edit(project, 'src/contract/index.ts', (text) =>
    text.replace("name: 'orders-service'", `name: '${name}'`),
  );
  const out = join(aFolder(), `contract-${name}`);
  expect(packageIn(project, '--out', out).status).toBe(0);
  linkPeers(out);
  expect(typeCheck(out).status).toBe(0);
  return out;
}

/**
 * A preload hook that kills the process at the chosen file-system call touching the package
 * folder, so a test sees what an interrupted run leaves.
 */
const killHook = lines([
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const which = process.env.killOn;',
  'const at = Number(process.env.killAt);',
  'let count = 0;',
  "for (const name of ['renameSync', 'rmSync', 'writeFileSync', 'mkdirSync']) {",
  '  const original = fs[name];',
  '  fs[name] = function (...args) {',
  "    if (name === which && String(args[0]).includes('contract-package') && ++count === at) {",
  "      process.kill(process.pid, 'SIGKILL');",
  '    }',
  '    return original.apply(this, args);',
  '  };',
  '}',
  'syncBuiltinESMExports();',
]);

/**
 * How long a kill test may run: two `package` runs per file-system call it kills at, some twenty
 * calls for the most frequent one, each run a fresh Node process.
 */
const killTestTimeout = 60_000;

/** Runs `package`, killed at the `at`th call of a file-system function on the package folder. */
function killedPackage(
  project: string,
  hook: string,
  kill: { readonly on: string; readonly at: number },
) {
  const ran = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, bin, 'package'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, killOn: kill.on, killAt: String(kill.at) },
  });
  return { status: ran.status, signal: ran.signal };
}

/** The Contract Package built in a folder of its own, where only its two peers are installed. */
function builtPackage(): string {
  const project = aProject(service);
  const out = join(aFolder(), 'contract-orders-service');
  expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
  linkPeers(out);
  return out;
}

/**
 * `@org/billing-service`, a Service subscribing to both of orders' Events through a Dependency,
 * its contract file ending with the lines given, with `@cf-loom/handlers`, which the readers and
 * stubs `generate` writes for its Subscriptions import.
 */
function aSubscriber(more: readonly string[]): string {
  const project = aProject({
    'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    'cf-loom.config.ts': config,
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'nodenext',
        noEmit: true,
        strict: true,
        target: 'es2024',
        types: [],
      },
      include: ['src'],
    }),
    'src/contract/index.ts': lines([
      "import { defineContract, defineDependencies, defineSubscription } from '@cf-loom/contract';",
      "import { contract as orders } from '@org/contract-orders-service';",
      '',
      'export const ordersDeps = defineDependencies(orders, {',
      '  events: [orders.events.orderPlacedV1, orders.events.orderPlacedV2],',
      '});',
      'const auditPlacedV1 = defineSubscription({',
      "  name: 'audit-placed-v1',",
      '  event: ordersDeps.events.orderPlacedV1,',
      '});',
      'const auditPlacedV2 = defineSubscription({',
      "  name: 'audit-placed-v2',",
      '  event: ordersDeps.events.orderPlacedV2,',
      '});',
      'export const contract = defineContract({',
      "  name: 'billing-service',",
      '  subscriptions: [auditPlacedV1, auditPlacedV2],',
      '  dependencies: [ordersDeps],',
      '});',
      ...more,
    ]),
  });
  link(join(packagesDir, 'handlers'), join(project, 'node_modules/@cf-loom/handlers'));
  return project;
}

describe('cf-loom package: the files', () => {
  test('package writes the Contract Package of the Public and Internal Endpoints and the Internal Events', () => {
    const project = aProject(service);

    const ran = packageIn(project);

    expect(ran).toEqual({ status: 0, stdout: 'Wrote contract-package\n', stderr: '' });
    expect(filesIn(join(project, 'contract-package'))).toEqual([
      'package.json',
      'snapshot.json',
      'src',
      'src/endpoints',
      'src/endpoints/get-order.ts',
      'src/endpoints/list-orders.ts',
      'src/events',
      'src/events/order-placed.v1.ts',
      'src/events/order-placed.v2.ts',
      'src/exported-snapshot.ts',
      'src/guards',
      'src/guards/permission.ts',
      'src/guards/user-token.ts',
      'src/index.ts',
      'src/rejections',
      'src/rejections/forbidden.ts',
      'src/rejections/order-locked.ts',
      'src/snapshot.ts',
      'src/standard-rejections.ts',
      'tsconfig.json',
    ]);
  });

  test('every TypeScript file starts with the line that says package wrote it', () => {
    const project = aProject(service);

    packageIn(project);

    expect(read(project, 'contract-package/src/index.ts')).toMatch(
      /^\/\/ Generated by cf-loom package\. Do not edit\.\n/,
    );
    expect(read(project, 'contract-package/src/guards/permission.ts')).toMatch(
      /^\/\/ Generated by cf-loom package\. Do not edit\.\n/,
    );
  });

  test('package.json names the package after the Service, at 0.0.0, with the two peers as built', () => {
    const project = aProject(service);

    packageIn(project);

    expect(JSON.parse(read(project, 'contract-package/package.json'))).toEqual({
      name: '@org/contract-orders-service',
      version: '0.0.0',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist', 'snapshot.json'],
      sideEffects: false,
      peerDependencies: {
        '@cf-loom/contract': `^${contractVersion}`,
        zod: `^${zodVersion}`,
      },
      cfLoom: {
        format: 1,
        kind: 'service',
        dependencies: {},
        snapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
  });

  test('snapshotHash is the SHA-256 of the canonical Snapshot without its generator', () => {
    const project = aProject(service);

    packageIn(project);

    const snapshot = JSON.parse(read(project, 'contract-package/snapshot.json'));
    delete snapshot.generator;
    const text = `${JSON.stringify(sortedKeys(snapshot), null, 2)}\n`;
    const hash = createHash('sha256').update(text, 'utf8').digest('hex');
    const manifest = JSON.parse(read(project, 'contract-package/package.json'));
    expect(manifest.cfLoom.snapshotHash).toBe(hash);
  });

  test('snapshot.json is the Snapshot generate writes', () => {
    const project = aProject(service);
    cfLoom(project, 'generate');

    packageIn(project);

    expect(read(project, 'contract-package/snapshot.json')).toBe(
      read(project, 'contract.snapshot.json'),
    );
  });

  test('nothing Private, no Retired Event, no Command, no Subscription and no Definitions Package is written into the package', () => {
    const project = aProject(service);

    packageIn(project);

    const out = join(project, 'contract-package');
    const code = filesIn(out)
      .filter((file) => file.endsWith('.ts') && file !== 'src/snapshot.ts')
      .map((file) => read(out, file))
      .join('\n');
    const absents = ['adminOrder', 'apiKey', 'ADMIN_ONLY', 'category', 'StockReserved'];
    for (const absent of [...absents, 'OrderPurged', 'ChargeCard', 'audit-placed']) {
      expect(code).not.toContain(absent);
    }
    const imports = code.replace(read(out, 'src/exported-snapshot.ts'), '');
    expect(imports).not.toContain('@org/definitions');
    expect(read(out, 'package.json')).not.toContain('@org/definitions');
  });

  test('the Definitions Package’s Guard and shared schema are written in', () => {
    const project = aProject(service);

    packageIn(project);

    expect(read(project, 'contract-package/src/guards/permission.ts')).toContain(
      "z.array(z.enum(['orders:edit', 'orders:read'])).min(1)",
    );
    expect(read(project, 'contract-package/src/endpoints/get-order.ts')).toContain(
      'total: z.object({ amount: z.int(), currency: z.string() })',
    );
  });

  test('an Event’s file declares it with defineEvent: its name, version, Visibility and description, and its lifecycle only when Deprecated', () => {
    const project = aProject(service);

    packageIn(project);

    const out = join(project, 'contract-package');
    expect(read(out, 'src/events/order-placed.v1.ts')).toContain(
      [
        'export const orderPlacedEventV1 = loom.defineEvent({',
        "  name: 'OrderPlaced',",
        '  version: 1,',
        "  visibility: 'internal',",
        "  description: 'An order was placed',",
        "  lifecycle: 'deprecated',",
        '  body: z.object({ orderId: z.uuid() }),',
        '});',
      ].join('\n'),
    );
    expect(read(out, 'src/events/order-placed.v2.ts')).toContain(
      [
        'export const orderPlacedEventV2 = loom.defineEvent({',
        "  name: 'OrderPlaced',",
        '  version: 2,',
        "  visibility: 'internal',",
        "  description: 'An order was placed, with its total',",
        '  body: z.object({',
      ].join('\n'),
    );
  });

  test('an Event’s body is written as a reader, an Open Enum as loom.openEnumReader', () => {
    const project = aProject(service);

    packageIn(project);

    expect(read(project, 'contract-package/src/events/order-placed.v2.ts')).toContain(
      "status: loom.openEnumReader(['paid', 'pending'])",
    );
  });

  test('the entry keys Events by name in code, each bound as <name>EventV<n>', () => {
    const project = aProject(service);

    packageIn(project);

    expect(read(project, 'contract-package/src/index.ts')).toContain(
      [
        '  events: {',
        '    orderPlacedV1: orderPlacedEventV1,',
        '    orderPlacedV2: orderPlacedEventV2,',
        '  },',
      ].join('\n'),
    );
  });

  test('the entry lists Events in code point order of their names in code, which may differ from the Snapshot’s', () => {
    const ship = (name: string) =>
      `export const ${name} = defineEvent({ name: '${name}', version: 1, visibility: 'internal', description: '${name}', body: z.object({}) });`;
    const project = aProject(withEvents([ship('Ship'), ship('ShipUpdated')], 'Ship, ShipUpdated'));

    packageIn(project);

    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    expect(Object.keys(snapshot.events)).toEqual(['Ship@1', 'ShipUpdated@1']);
    expect(read(project, 'contract-package/src/index.ts')).toContain(
      [
        '  events: {',
        '    shipUpdatedV1: shipUpdatedEventV1,',
        '    shipV1: shipEventV1,',
        '  },',
      ].join('\n'),
    );
  });

  test('a Service exporting no Event writes events: {}', () => {
    const project = aProject(withDeclarations([], ''));

    packageIn(project);

    expect(read(project, 'contract-package/src/index.ts')).toContain('\n  events: {},\n');
  });
  test('every binding is suffixed by its kind, and the entry keys Endpoints by name', () => {
    const project = aProject(service);

    packageIn(project);

    const out = join(project, 'contract-package');
    expect(read(out, 'src/index.ts')).toContain(
      [
        '  endpoints: {',
        '    getOrder: getOrderEndpoint,',
        '    listOrders: listOrdersEndpoint,',
        '  },',
      ].join('\n'),
    );
    const getOrder = read(out, 'src/endpoints/get-order.ts');
    expect(getOrder).toContain("import * as loom from '@cf-loom/contract';");
    expect(getOrder).toContain('export const getOrderEndpoint = loom.defineEndpoint({');
    expect(getOrder).toContain(
      '  guards: [userTokenGuard, { guard: permissionGuard, qualifier: ["orders:read"] }],',
    );
    expect(getOrder).toContain('  rejections: [loom.notFound, orderLockedRejection],');
    expect(read(out, 'src/guards/permission.ts')).toContain(
      'export const permissionGuard = loom.defineGuard({',
    );
    expect(read(out, 'src/rejections/order-locked.ts')).toContain(
      'export const orderLockedRejection = loom.defineRejection({',
    );
  });

  test('the files are a function of the canonical Snapshot, whatever order the Contract declares', () => {
    const active = (service['src/contract/index.ts'] ?? '').replace(
      "  lifecycle: 'deprecated',\n",
      '',
    );
    const swapped = active
      .replace(
        "body: z.object({ id: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),",
        "body: z.object({ total: money, status: openEnum(['paid', 'pending']), id: z.uuid() }),",
      )
      .replace('guards: [userToken, permission],', 'guards: [permission, userToken],');
    const first = aProject({ ...service, 'src/contract/index.ts': active });
    const second = aProject({ ...service, 'src/contract/index.ts': swapped });

    packageIn(first);
    packageIn(second);

    const out = 'contract-package';
    for (const file of filesIn(join(first, out)).filter((path) => path.includes('.'))) {
      expect(read(second, join(out, file))).toBe(read(first, join(out, file)));
    }
  });
  test('package needs the committed Snapshot up to date, so it never stamps a deprecatedAt itself', () => {
    const project = aProject(service);

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'contract.snapshot.json is missing or out of date: run cf-loom generate\n',
    });
    expect(existsSync(join(project, 'contract-package'))).toBe(false);
  });

  test('two package runs from one committed Snapshot give the same bytes and hash', () => {
    const project = aProject(service);
    expect(cfLoom(project, 'generate').status).toBe(0);
    expect(cfLoom(project, 'package', '--out', 'first').status).toBe(0);

    const ran = cfLoom(project, 'package', '--out', 'second');

    expect(ran.status).toBe(0);
    for (const file of filesIn(join(project, 'first')).filter((path) => path.includes('.'))) {
      expect(read(project, join('second', file))).toBe(read(project, join('first', file)));
    }
  });

  test('the tsconfig builds with no ambient types, and the entry is checked as a ContractPackage', () => {
    const project = aProject(service);

    packageIn(project);

    const tsconfig = JSON.parse(read(project, 'contract-package/tsconfig.json'));
    expect(tsconfig.compilerOptions.types).toEqual([]);
    expect(read(project, 'contract-package/src/index.ts')).toContain(
      '} satisfies loom.ContractPackage;',
    );
  });

  test('a file imports its siblings, then loom, then zod, by specifier', () => {
    const project = aProject(service);

    packageIn(project);

    expect(read(project, 'contract-package/src/endpoints/get-order.ts')).toMatch(
      new RegExp(
        [
          '^// Generated by cf-loom package\\. Do not edit\\.\\n',
          "import \\{ permissionGuard \\} from '\\.\\./guards/permission\\.ts';\\n",
          "import \\{ userTokenGuard \\} from '\\.\\./guards/user-token\\.ts';\\n",
          "import \\{ orderLockedRejection \\} from '\\.\\./rejections/order-locked\\.ts';\\n",
          "import \\* as loom from '@cf-loom/contract';\\n",
          "import \\{ z \\} from 'zod';\\n\\n",
        ].join(''),
      ),
    );
  });
});

describe('cf-loom package: the built package', () => {
  test('tsc builds it with only zod and @cf-loom/contract installed', () => {
    const out = builtPackage();

    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });
  });

  test('its entry exports contract, with the Endpoints that are not Retired, and snapshot', async () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    expect(built.contract).toMatchObject({
      name: 'orders-service',
      version: '0.0.0',
      standardRejections: {
        invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
        notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
        notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
      },
    });
    expect(Object.keys(built.contract.endpoints)).toEqual(['getOrder', 'listOrders']);
    expect(Object.keys(built.contract.events)).toEqual(['orderPlacedV1', 'orderPlacedV2']);
    expect(built.contract.endpoints.listOrders.lifecycle).toBe('deprecated');
    expect(built.contract.endpoints.getOrder.lifecycle).toBeUndefined();
    expect(built.snapshot).toEqual(JSON.parse(read(out, 'snapshot.json')));
  });

  test('its Events are Event declarations with the Snapshot’s Visibility and description, a Deprecated one’s lifecycle kept and an Active one’s left out', async () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    const { orderPlacedV1, orderPlacedV2 } = built.contract.events;
    expect(orderPlacedV1).toMatchObject({
      kind: 'event',
      name: 'OrderPlaced',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      lifecycle: 'deprecated',
    });
    expect(orderPlacedV2).toMatchObject({
      kind: 'event',
      name: 'OrderPlaced',
      version: 2,
      visibility: 'internal',
      description: 'An order was placed, with its total',
    });
    expect(Object.keys(orderPlacedV2)).not.toContain('lifecycle');
  });

  test('its contract carries the Snapshot cut to the Endpoints and Events it exports and what they reach', async () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    const { snapshot } = built;
    const exported = built.contract.exportedSnapshot;
    expect(exported).toEqual({
      format: 1,
      defs: {},
      endpoints: {
        'GET /orders': snapshot.endpoints['GET /orders'],
        'GET /orders/{}': snapshot.endpoints['GET /orders/{}'],
      },
      events: {
        'OrderPlaced@1': snapshot.events['OrderPlaced@1'],
        'OrderPlaced@2': snapshot.events['OrderPlaced@2'],
      },
      guards: { permission: snapshot.guards.permission, userToken: snapshot.guards.userToken },
      codes: {
        // biome-ignore lint/style/useNamingConvention: a Rejection code, as the Snapshot keys it
        FORBIDDEN: snapshot.codes.FORBIDDEN,
        // biome-ignore lint/style/useNamingConvention: a Rejection code, as the Snapshot keys it
        ORDER_LOCKED: snapshot.codes.ORDER_LOCKED,
      },
    });
    const names = Object.values(exported.endpoints).map((endpoint) =>
      Reflect.get(Object(endpoint), 'name'),
    );
    expect(names.sort()).toEqual(Object.keys(built.contract.endpoints).sort());
  });

  test('a Consumer declares a Dependency on it, type-checks and generates', () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);
    const consumer = aProject({
      'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
      'cf-loom.config.ts': config,
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          module: 'nodenext',
          noEmit: true,
          strict: true,
          target: 'es2024',
          types: [],
        },
        include: ['src'],
      }),
      'src/contract/index.ts': lines([
        "import { defineApplication, defineDependencies } from '@cf-loom/contract';",
        "import { contract as orders } from '@org/contract-orders-service';",
        '',
        'export const ordersDeps = defineDependencies(orders, {',
        '  endpoints: [orders.endpoints.getOrder],',
        '});',
        '',
        "export const application = defineApplication({ name: 'web-admin', dependencies: [ordersDeps] });",
      ]),
    });
    link(out, join(consumer, 'node_modules/@org/contract-orders-service'));

    const ran = cfLoom(consumer, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(typeCheck(consumer)).toEqual({ status: 0, stdout: '' });
    const snapshot = JSON.parse(read(consumer, 'contract.snapshot.json'));
    expect(snapshot.dependencies).toEqual({
      'orders-service': {
        against: '0.0.0',
        endpoints: [{ id: 'GET /orders/{}', name: 'getOrder' }],
        events: [],
      },
    });
  });

  test('a Consumer Service subscribes to its Event through a Dependency, type-checks and generates', () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);
    const consumer = aSubscriber([]);
    link(out, join(consumer, 'node_modules/@org/contract-orders-service'));

    const ran = cfLoom(consumer, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(typeCheck(consumer)).toEqual({ status: 0, stdout: '' });
    const snapshot = JSON.parse(read(consumer, 'contract.snapshot.json'));
    expect(snapshot.subscriptions).toEqual({
      'audit-placed-v1': { event: 'orders-service:OrderPlaced@1' },
      'audit-placed-v2': { event: 'orders-service:OrderPlaced@2' },
    });
    expect(snapshot.dependencies['orders-service'].events).toEqual([
      'OrderPlaced@1',
      'OrderPlaced@2',
    ]);
  });

  test('a Subscriber’s body type is the Event’s Reader output: an Unknown case type-checks and a bare undeclared value does not', () => {
    const out = builtPackage();
    expect(typeCheck(out).status).toBe(0);
    const consumer = aSubscriber([
      "import type { z } from 'zod';",
      'type Placed = z.output<typeof ordersDeps.events.orderPlacedV2.body>;',
      'const total = { amount: 1, currency: "EUR" };',
      'const orderId = "6f1c1b9e-6c1e-4f9b-9d4c-1f2e3d4c5b6a";',
      "export const read: Placed = { orderId, status: { unknown: 'refunded' }, total };",
      '// @ts-expect-error an undeclared value is read as its Unknown case only',
      "export const bare: Placed = { orderId, status: 'refunded', total };",
    ]);
    link(out, join(consumer, 'node_modules/@org/contract-orders-service'));

    const checked = typeCheck(consumer);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test('a discriminated union’s variants are in canonical order, whatever order they are declared in', () => {
    const variants = [
      "z.object({ kind: z.literal('circle'), r: z.number() })",
      "z.object({ kind: z.literal('square'), side: z.number() })",
    ];
    const unionOf = (listed: readonly string[]) =>
      `z.object({ shape: z.discriminatedUnion('kind', [${listed.join(', ')}]) })`;
    const first = aProject(withDeclarations([], '', unionOf(variants)));
    const second = aProject(withDeclarations([], '', unionOf([...variants].reverse())));

    packageIn(first);
    packageIn(second);

    const endpoint = 'contract-package/src/endpoints/ping.ts';
    expect(read(second, endpoint)).toBe(read(first, endpoint));
  });

  test('cfLoom.dependencies is in canonical order, whatever order the root lists them in', () => {
    const alpha = aProviderPackage('alpha-service');
    const beta = aProviderPackage('beta-service');
    const applicationOf = (listed: string) => {
      const project = aProject({
        'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
        'cf-loom.config.ts': config,
        'src/contract/index.ts': lines([
          "import { defineApplication, defineDependencies } from '@cf-loom/contract';",
          "import { contract as alpha } from '@org/contract-alpha-service';",
          "import { contract as beta } from '@org/contract-beta-service';",
          'export const alphaDeps = defineDependencies(alpha, { endpoints: [alpha.endpoints.ping] });',
          'export const betaDeps = defineDependencies(beta, { endpoints: [beta.endpoints.ping] });',
          `export const application = defineApplication({ name: 'web-admin', dependencies: [${listed}] });`,
        ]),
      });
      link(alpha, join(project, 'node_modules/@org/contract-alpha-service'));
      link(beta, join(project, 'node_modules/@org/contract-beta-service'));
      return project;
    };
    const first = applicationOf('alphaDeps, betaDeps');
    const second = applicationOf('betaDeps, alphaDeps');

    packageIn(first);
    packageIn(second);

    expect(read(second, 'contract-package/package.json')).toBe(
      read(first, 'contract-package/package.json'),
    );
    expect(read(first, 'contract-package/package.json')).toMatch(
      /"alpha-service"[\s\S]*"beta-service"/,
    );
  });

  test('a discriminated union with a recursive variant is typed soundly: a wrong written type fails tsc', () => {
    const union = "z.discriminatedUnion('kind', [z.object({ kind: z.literal('stem') }), twig])";
    const project = aProject(
      withDeclarations(
        [
          'export const twig = z',
          `  .object({ kind: z.literal('twig'), get up() { return ${union}.optional(); } })`,
          "  .meta({ id: 'twig' });",
        ],
        '',
        `z.object({ stem: ${union} })`,
      ),
    );
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);
    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });
    const written = read(out, 'src/defs.ts');
    const wrong = written.replaceAll("{ kind: 'stem' }", "{ kind: 'stem'; extra: number }");
    expect(wrong).not.toBe(written);
    write(out, { 'src/defs.ts': wrong });

    const checked = typeCheck(out);

    expect(checked.status).not.toBe(0);
  });

  test('a def chain a to b, where only a is referenced, writes both, each typed exactly as declared', () => {
    const files = withDeclarations(
      [
        "export const b = z.object({ name: z.string(), get a() { return a.optional(); } }).meta({ id: 'b' });",
        "export const a = z.object({ get b() { return b.optional(); } }).meta({ id: 'a' });",
      ],
      '',
      'a',
    );
    const project = aProject({
      ...files,
      'src/contract/index.ts': (files['src/contract/index.ts'] ?? '').replace(
        '  success: { status: 200, body: a },',
        '  input: { query: z.object({}) },\n  success: { status: 200, body: a },',
      ),
    });
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);

    const defs = read(out, 'src/defs.ts');

    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });
    expect(defs).toContain('export type AReaderDef = { b?: BReaderDef };');
    expect(defs).toContain('export type BReaderDef = { a?: AReaderDef; name: string };');
    expect(defs).toContain(
      'export const aReaderDef: z.ZodType<AReaderDef> & z.core.$ZodTypeDiscriminable =',
    );
  });

  test('a declared def is typed with its input exact, a recursive list without being discriminable', () => {
    const files = withDeclarations(
      [
        "export const tree = z.object({ get children() { return z.array(tree); } }).meta({ id: 'tree' });",
        "export const nested = z.array(z.union([z.string(), z.lazy(() => nested)])).meta({ id: 'nested' });",
        'export const both = z.object({ tree, nested });',
      ],
      '',
      'both',
    );
    const project = aProject({
      ...files,
      'src/contract/index.ts': (files['src/contract/index.ts'] ?? '')
        .replace("method: 'GET'", "method: 'POST'")
        .replace(
          '  success: { status: 200, body: both },',
          '  input: { body: both },\n  success: { status: 200, body: both },',
        ),
    });
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);

    const defs = read(out, 'src/defs.ts');

    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });
    expect(defs).toContain(
      'export const treeDef: z.ZodType<TreeDef, TreeDef> & z.core.$ZodTypeDiscriminable =',
    );
    expect(defs).toContain('export const nestedDef: z.ZodType<NestedDef, NestedDef> =');
    expect(defs).toContain('export const nestedReaderDef: z.ZodType<NestedReaderDef> =');
  });

  test('a Consumer that emits declarations names the recursive defs its Dependency reaches', () => {
    const files = withDeclarations(
      [
        "export const category = z.object({ name: z.string(), get children() { return z.array(category); } }).meta({ id: 'category' });",
      ],
      '',
      'category',
    );
    const provider = aProject(files);
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(provider, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);
    expect(typeCheck(out).status).toBe(0);
    expect(read(out, 'src/index.ts')).toContain(
      "export type { CategoryReaderDef } from './defs.ts';",
    );
    const consumer = aProject({
      'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
      'cf-loom.config.ts': config,
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          declaration: true,
          emitDeclarationOnly: true,
          module: 'nodenext',
          outDir: 'out',
          rootDir: 'src',
          strict: true,
          target: 'es2024',
          types: [],
        },
        include: ['src'],
      }),
      'src/contract/index.ts': lines([
        "import { defineApplication, defineDependencies } from '@cf-loom/contract';",
        "import { contract as orders } from '@org/contract-orders-service';",
        'export const ordersDeps = defineDependencies(orders, { endpoints: [orders.endpoints.ping] });',
        "export const application = defineApplication({ name: 'web-admin', dependencies: [ordersDeps] });",
      ]),
    });
    link(out, join(consumer, 'node_modules/@org/contract-orders-service'));

    const checked = typeCheck(consumer);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test('the exported Snapshot’s defs are exactly the defs defs.ts declares', async () => {
    const files = withDeclarations(
      [
        "export const leaf = z.object({ get up() { return z.array(leaf); } }).meta({ id: 'leaf' });",
        "export const branch = z.object({ get leaves() { return z.array(leaf); }, get self() { return branch.optional(); } }).meta({ id: 'branch' });",
        "export const unused = z.object({ get self() { return unused.optional(); } }).meta({ id: 'unused' });",
        "export const session = defineGuard({ name: 'session', description: 'A session', demands: { headers: z.object({ authorization: z.string() }) }, context: z.object({ branch }) });",
      ],
      '',
    );
    const project = aProject({
      ...files,
      'src/contract/index.ts': (files['src/contract/index.ts'] ?? '')
        .replace('defineRejection }', 'defineRejection, defineGuard }')
        .replace("  description: 'Ping',", "  description: 'Ping',\n  guards: [session],"),
    });
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);
    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    expect(Object.keys(built.contract.exportedSnapshot.defs).sort()).toEqual(['branch', 'leaf']);
  });

  test('a recursive def only an exported Event reaches is written to defs.ts and kept in the exported Snapshot', async () => {
    const project = aProject(
      withEvents(
        [
          "export const leaf = z.object({ get up() { return z.array(leaf); } }).meta({ id: 'leaf' });",
          "export const grown = defineEvent({ name: 'Grown', version: 1, visibility: 'internal', description: 'Grown', body: z.object({ leaf }) });",
        ],
        'grown',
      ),
    );
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);
    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    expect(Object.keys(built.contract.exportedSnapshot.defs)).toEqual(['leaf']);
    expect(read(out, 'src/defs.ts')).toContain('export const leafReaderDef');
  });

  test('defs reached through an array and through a tuple’s rest are both written', () => {
    const files = withDeclarations(
      [
        "export const leaf = z.object({ get up() { return z.array(leaf); } }).meta({ id: 'leaf' });",
        "export const knot = z.object({ get next() { return z.tuple([]).rest(knot); } }).meta({ id: 'knot' });",
        "export const root = z.object({ get leaves() { return z.array(leaf); }, get knots() { return z.tuple([]).rest(knot); }, get self() { return root.optional(); } }).meta({ id: 'root' });",
      ],
      '',
      'root',
    );
    const project = aProject(files);
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);

    const defs = read(out, 'src/defs.ts');

    expect(typeCheck(out)).toEqual({ status: 0, stdout: '' });
    expect(defs).toContain('export const leafReaderDef');
    expect(defs).toContain('export const knotReaderDef');
    expect(defs).toContain('.rest(');
  });

  test('an Application’s package exports its Snapshot only, and builds', async () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/contract/index.ts': lines([
        "import { defineApplication } from '@cf-loom/contract';",
        "export const application = defineApplication({ name: 'web-admin', dependencies: [] });",
      ]),
    });
    const out = join(aFolder(), 'contract-web-admin');
    expect(packageIn(project, '--out', out).status).toBe(0);
    linkPeers(out);
    expect(typeCheck(out).status).toBe(0);

    const built = await import(pathToFileURL(join(out, 'dist/index.js')).href);

    expect(filesIn(out).filter((file) => !file.startsWith('dist'))).toEqual([
      'package.json',
      'snapshot.json',
      'src',
      'src/index.ts',
      'src/snapshot.ts',
      'tsconfig.json',
    ]);
    expect(Object.keys(built)).toEqual(['snapshot']);
    expect(JSON.parse(read(out, 'package.json')).cfLoom.kind).toBe('application');
  });
});

describe('cf-loom package: where it writes', () => {
  test('a folder holding other files is refused, a tooling error, and kept as it was', () => {
    const project = aProject({ ...service, 'contract-package/notes.txt': 'mine' });

    const ran = packageIn(project);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'contract-package holds files package did not write: package writes to a missing or empty folder, or over its own output\n',
    });
    expect(filesIn(join(project, 'contract-package'))).toEqual(['notes.txt']);
  });

  test('a previous output is replaced whole', () => {
    const project = aProject(service);
    packageIn(project);
    write(project, { 'contract-package/src/endpoints/stale.ts': 'export {};\n' });

    const ran = packageIn(project);

    expect(ran.status).toBe(0);
    expect(existsSync(join(project, 'contract-package/src/endpoints/stale.ts'))).toBe(false);
  });

  test('an empty folder is written into', () => {
    const project = aProject({ ...service });
    mkdirSync(join(project, 'out'));

    const ran = packageIn(project, '--out', 'out');

    expect(ran).toEqual({ status: 0, stdout: 'Wrote out\n', stderr: '' });
    expect(existsSync(join(project, 'out/package.json'))).toBe(true);
  });
  test('a previous output installed and built in place is replaced, its install and build kept', () => {
    const project = aProject(service);
    packageIn(project);
    const out = join(project, 'contract-package');
    linkPeers(out);
    expect(typeCheck(out).status).toBe(0);

    const ran = packageIn(project);

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(out, 'dist/index.js'))).toBe(true);
    expect(lstatSync(join(out, 'node_modules/zod')).isSymbolicLink()).toBe(true);
  });

  test('a previous output holding an Event’s file is replaced whole, the Event no longer exported', () => {
    const project = aProject(service);
    packageIn(project);
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace(
        "  name: 'OrderPlaced',\n  version: 1,\n  visibility: 'internal',",
        "  name: 'OrderPlaced',\n  version: 1,\n  visibility: 'private',",
      ),
    );

    const ran = packageIn(project);

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(project, 'contract-package/src/events/order-placed.v1.ts'))).toBe(false);
    expect(existsSync(join(project, 'contract-package/src/events/order-placed.v2.ts'))).toBe(true);
  });

  test('a previous output holding an Event’s file at version 10 is replaced, the file kept', () => {
    const tenth =
      "export const placed = defineEvent({ name: 'OrderPlaced', version: 10, visibility: 'internal', description: 'Placed', body: z.object({}) });";
    const project = aProject(withEvents([tenth], 'placed'));
    packageIn(project);

    const ran = packageIn(project);

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(existsSync(join(project, 'contract-package/src/events/order-placed.v10.ts'))).toBe(true);
  });

  test.each(['stray.ts', 'order-placed.v0.ts', 'order-placed.v01.ts'])(
    'a file under src/events that package would not name, %s, is refused and kept',
    (file) => {
      const project = aProject(service);
      packageIn(project);
      write(project, { [`contract-package/src/events/${file}`]: 'export {};\n' });

      const ran = packageIn(project);

      expect(ran.status).toBe(3);
      expect(read(project, `contract-package/src/events/${file}`)).toBe('export {};\n');
    },
  );

  test('a previous output holding a stray file under src is refused and kept', () => {
    const project = aProject(service);
    packageIn(project);
    write(project, { 'contract-package/src/NOTES.md': 'mine' });

    const ran = packageIn(project);

    expect(ran.status).toBe(3);
    expect(read(project, 'contract-package/src/NOTES.md')).toBe('mine');
  });

  test('a committed contract.snapshot.json that is no JSON stops package, which advises generate', () => {
    const project = aProject({ ...service, 'contract.snapshot.json': '<<<<<<< HEAD\n' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/: restore it or delete it, then run cf-loom generate\n$/);
  });

  test('a committed contract.snapshot.json that is out of date stops package', () => {
    const project = aProject(service);
    cfLoom(project, 'generate');
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace("message: 'Locked'", "message: 'Held'"),
    );

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'contract.snapshot.json is missing or out of date: run cf-loom generate\n',
    });
  });

  test('a committed contract.snapshot.json another CLI wrote is current for package', () => {
    const project = aProject(service);
    cfLoom(project, 'generate');
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(/"generator": "[^"]+"/, '"generator": "@cf-loom/cli@0.0.1"'),
    );

    const ran = cfLoom(project, 'package');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'contract-package/snapshot.json')).toContain('@cf-loom/cli@0.0.1');
  });

  test('a committed contract.snapshot.json that cannot be read stops package in one line', () => {
    const project = aProject({ ...service, 'contract.snapshot.json/kept.txt': '' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^contract\.snapshot\.json cannot be read: EISDIR[^\n]*\n$/);
  });

  test('a listed Definitions Package that cannot be loaded stops package in one line', () => {
    const project = aProject({
      ...service,
      'node_modules/@org/definitions/package.json': JSON.stringify({
        name: '@org/definitions',
        version: '4.2.0',
        type: 'module',
        exports: { '.': './broken.js', './all': './index.js' },
      }),
      'node_modules/@org/definitions/broken.js': 'export const = ;\n',
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '').replace(
        "from '@org/definitions';",
        "from '@org/definitions/all';",
      ),
    });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^@org\/definitions cannot be loaded: [^\n]+\n$/);
  });

  test('a previous output holding a file package does not write is refused and kept', () => {
    const project = aProject(service);
    packageIn(project);
    write(project, { 'contract-package/notes.txt': 'mine' });

    const ran = packageIn(project);

    expect(ran.status).toBe(3);
    expect(read(project, 'contract-package/notes.txt')).toBe('mine');
  });

  test('the project itself is refused, and nothing in it is deleted', () => {
    const project = aProject(service);
    edit(project, 'package.json', (text) => JSON.stringify({ ...JSON.parse(text), cfLoom: {} }));

    const ran = packageIn(project, '--out', '.');

    expect(ran.status).toBe(3);
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(true);
  });

  test('a symbolic link is refused, not replaced', () => {
    const project = aProject(service);
    packageIn(project, '--out', 'real');
    symlinkSync(join(project, 'real'), join(project, 'linked'));

    const ran = packageIn(project, '--out', 'linked');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'linked is a symbolic link: package writes a folder of its own\n',
    });
    expect(lstatSync(join(project, 'linked')).isSymbolicLink()).toBe(true);
  });
  test.skipIf(isRoot)(
    'a write that fails keeps the previous output’s install and build (skipped as root)',
    () => {
      const project = aProject(service);
      packageIn(project);
      const out = join(project, 'contract-package');
      write(project, {
        'contract-package/node_modules/kept.txt': 'install',
        'contract-package/dist/index.js': 'export {};\n',
      });
      chmodSync(join(out, 'src/endpoints'), 0o555);

      const ran = cfLoom(project, 'package');

      chmodSync(join(out, 'src/endpoints'), 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^contract-package cannot be written: [^\n]+\n$/);
      expect(read(project, 'contract-package/node_modules/kept.txt')).toBe('install');
      expect(read(project, 'contract-package/dist/index.js')).toBe('export {};\n');
    },
  );

  test('a file where the folder would go is refused', () => {
    const project = aProject({ ...service, 'out.txt': 'mine' });

    const ran = packageIn(project, '--out', 'out.txt');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'out.txt is no folder: package writes a folder\n',
    });
  });

  test('--out without a folder is a usage error', () => {
    const project = aProject(service);

    const ran = cfLoom(project, 'package', '--out');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^--out takes a folder\. Usage: /);
  });
  test.each([
    ['not in kebab-case', 'src/endpoints/My Notes.ts'],
    ['a test', 'src/endpoints/get-order.test.ts'],
    ['a declaration', 'src/endpoints/get-order.d.ts'],
    ['no name', 'src/endpoints/.ts'],
    ['in a nested folder', 'src/endpoints/old/get-order.ts'],
  ])('a previous output holding a file %s is refused and kept', (_name, path) => {
    const project = aProject(service);
    packageIn(project);
    write(project, { [`contract-package/${path}`]: 'mine' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(read(project, `contract-package/${path}`)).toBe('mine');
  });

  test('a folder of package files whose package.json has no cfLoom is refused', () => {
    const project = aProject({
      ...service,
      'contract-package/package.json': JSON.stringify({ name: 'mine' }),
      'contract-package/src/index.ts': 'export {};\n',
    });
    cfLoom(project, 'generate');

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(read(project, 'contract-package/package.json')).toBe(JSON.stringify({ name: 'mine' }));
  });

  test('package leaves no folder of its own beside the target', () => {
    const project = aProject(service);

    packageIn(project);
    packageIn(project);

    expect(readdirSync(project).filter((entry) => entry.startsWith('.contract-package'))).toEqual(
      [],
    );
  });

  test.skipIf(isRoot)(
    'a previous output that cannot be read is a tooling error in one line (skipped as root)',
    () => {
      const project = aProject(service);
      packageIn(project);
      chmodSync(join(project, 'contract-package/src'), 0o000);

      const ran = cfLoom(project, 'package');

      chmodSync(join(project, 'contract-package/src'), 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^contract-package cannot be read: EACCES[^\n]*\n$/);
    },
  );

  test('an empty --out is a usage error', () => {
    const project = aProject(service);

    const ran = cfLoom(project, 'package', '--out=');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^--out takes a folder\. Usage: /);
  });
  test.each(['rmSync', 'renameSync', 'writeFileSync', 'mkdirSync'])(
    'a replace killed at any %s leaves a previous output a rerun replaces, its install and build kept',
    (on) => {
      const project = aProject(service);
      packageIn(project);
      write(project, {
        'contract-package/node_modules/kept.txt': 'install',
        'contract-package/dist/index.js': 'export {};\n',
      });
      const hook = join(aFolder(), 'kill.mjs');
      writeFileSync(hook, killHook);
      const outcomes: (string | null)[] = [];

      for (let at = 1; at < 50; at++) {
        const killed = killedPackage(project, hook, { on, at });
        outcomes.push(killed.signal);
        const rerun = cfLoom(project, 'package');
        expect(rerun).toMatchObject({ status: 0, stderr: '' });
        expect(read(project, 'contract-package/node_modules/kept.txt')).toBe('install');
        expect(read(project, 'contract-package/dist/index.js')).toBe('export {};\n');
        if (killed.signal === null) {
          break;
        }
      }

      expect(outcomes.at(-1)).toBeNull();
      expect(outcomes.filter((signal) => signal === 'SIGKILL').length).toBeGreaterThan(0);
    },
    killTestTimeout,
  );
});

describe('cf-loom package: what it refuses', () => {
  test('a Definitions Package root is refused before any Snapshot is looked at', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/definitions/index.ts': lines([
        "import { defineDefinitions } from '@cf-loom/contract';",
        "export const definitions = defineDefinitions({ name: 'definitions' });",
      ]),
    });

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'A Definitions Package has no Contract Package: it is published from its own source\n',
    });
  });

  test('a Definitions Package root is a tooling error', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/definitions/index.ts': lines([
        "import { defineDefinitions } from '@cf-loom/contract';",
        "export const definitions = defineDefinitions({ name: 'definitions' });",
      ]),
    });

    const ran = packageIn(project);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'A Definitions Package has no Contract Package: it is published from its own source\n',
    });
    expect(existsSync(join(project, 'contract-package'))).toBe(false);
  });

  test('a Contract that fails validation exits 1 as generate does', () => {
    const project = aProject({
      ...service,
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '').replace(
        "name: 'orders-service',",
        "name: 'Orders Service',",
      ),
    });

    const ran = packageIn(project);

    expect(ran.status).toBe(1);
    expect(ran.stderr).toBe(cfLoom(project, 'generate').stderr);
    expect(existsSync(join(project, 'contract-package'))).toBe(false);
  });

  test('two codes that are one name in code are a tooling error naming both', () => {
    const project = aProject(
      withDeclarations(
        [
          "export const first = defineRejection({ code: 'ORDER_1', status: 409, message: 'One' });",
          "export const second = defineRejection({ code: 'ORDER1', status: 422, message: 'Other' });",
        ],
        'rejections: [first, second],',
      ),
    );

    const ran = packageIn(project);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'The codes ORDER1 and ORDER_1 are one name in code: rename one of them\n',
    });
  });

  test.each([
    ['1tree', 'The recursion id 1tree is no name in code: rename it'],
    ['!!', 'The recursion id !! is no name in code: rename it'],
  ])('a recursion id %s that gives no name in code is a tooling error', (id, line) => {
    const project = aProject(
      withDeclarations(
        [
          `export const tree = z.object({ get children() { return z.array(tree); } }).meta({ id: '${id}' });`,
        ],
        '',
        'tree',
      ),
    );

    const ran = packageIn(project);

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `${line}\n` });
  });

  test('a recursion id only a Private Endpoint reaches does not stop package', () => {
    const files = withDeclarations(
      [
        "export const tree = z.object({ get children() { return z.array(tree); } }).meta({ id: '1tree' });",
      ],
      '',
      'tree',
    );
    const project = aProject({
      ...files,
      'src/contract/index.ts': (files['src/contract/index.ts'] ?? '').replace(
        "visibility: 'public'",
        "visibility: 'private'",
      ),
    });

    const ran = packageIn(project);

    expect(ran).toMatchObject({ status: 0, stderr: '' });
  });

  test('two recursion ids whose names in code meet in any mode are a tooling error naming both', () => {
    const project = aProject(
      withDeclarations(
        [
          "export const tree = z.object({ get next() { return tree.optional(); } }).meta({ id: 'tree' });",
          "export const other = z.object({ get next() { return other.optional(); } }).meta({ id: 'tree-reader' });",
        ],
        '',
        'z.object({ tree, other })',
      ),
    );

    const ran = packageIn(project);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'The recursion ids tree and tree-reader are one name in code: rename one of them\n',
    });
  });

  test('a local code NOT_FOUND beside the Standard not-found Rejection builds', () => {
    const project = aProject({
      ...service,
      'node_modules/@org/definitions/index.js': (
        service['node_modules/@org/definitions/index.js'] ?? ''
      ).replace(
        '  schemas: { money },\n  rejections: [forbidden],\n});',
        "  schemas: { money },\n  rejections: [forbidden],\n  standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },\n});",
      ),
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '')
        .replace(
          'export const adminOnly',
          "export const localNotFound = defineRejection({ code: 'NOT_FOUND', status: 404, message: 'Gone' });\nexport const adminOnly",
        )
        .replace(
          'rejections: [notFound, orderLocked],',
          'rejections: [notFound, orderLocked, localNotFound],',
        ),
    });
    const out = join(aFolder(), 'contract-orders-service');
    expect(packageIn(project, '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);

    const built = typeCheck(out);

    expect(built).toEqual({ status: 0, stdout: '' });
  });

  test('zod not installed beside the root is a tooling error', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/contract/index.ts': lines([
        "import { defineApplication } from '@cf-loom/contract';",
        "export const application = defineApplication({ name: 'web-admin', dependencies: [] });",
      ]),
    });
    expect(cfLoom(project, 'generate').status).toBe(0);
    rmSync(join(project, 'node_modules/zod'));

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'zod is not installed: a Contract Package is built with it\n',
    });
  });

  test('@cf-loom/contract installed with no version is a tooling error', () => {
    const project = aProject(service);
    expect(cfLoom(project, 'generate').status).toBe(0);
    const at = join(project, 'node_modules/@cf-loom/contract');
    const real = realpathSync(at);
    rmSync(at);
    mkdirSync(at);
    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    writeFileSync(join(at, 'package.json'), JSON.stringify({ ...manifest, version: undefined }));
    symlinkSync(join(real, 'dist'), join(at, 'dist'), 'dir');
    symlinkSync(join(real, 'node_modules'), join(at, 'node_modules'), 'dir');

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        '@cf-loom/contract has no version in its package.json: a Contract Package is built with it\n',
    });
  });

  test('package takes no argument but --out', () => {
    const project = aProject(service);

    const ran = packageIn(project, 'now');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^package takes no argument\. Usage: /);
  });
});
