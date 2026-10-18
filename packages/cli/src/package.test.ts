import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
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
  link(join(packagesDir, 'contract'), join(folder, 'node_modules/@casitafeliz/loom-contract'));
  link(zodDir, join(folder, 'node_modules/zod'));
}

/** A project in a temporary directory, with cf-loom and zod installed and the files given. */
function aProject(files: Readonly<Record<string, string>>): string {
  const project = aFolder();
  linkPeers(project);
  link(cliDir, join(project, 'node_modules/@casitafeliz/loom-cli'));
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
  "import { defineConfig } from '@casitafeliz/loom-cli';",
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
    "import { defineDefinitions, defineGuard, defineRejection } from '@casitafeliz/loom-contract';",
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
 * Internal one, a Private one with its own Guard, code and recursive schema, and a Retired one.
 */
const service: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: '@org/orders-service', type: 'module' }),
  'cf-loom.config.ts': config,
  ...definitions,
  'src/contract/index.ts': lines([
    'import {',
    '  defineContract,',
    '  defineEndpoint,',
    '  defineGroup,',
    '  defineGuard,',
    '  defineRejection,',
    '  notFound,',
    '  openEnum,',
    "} from '@casitafeliz/loom-contract';",
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
    'export const contract = defineContract({',
    "  name: 'orders-service',",
    '  definitions: [definitions],',
    '  groups: [orders],',
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
      "import { defineContract, defineEndpoint, defineGroup, defineRejection } from '@casitafeliz/loom-contract';",
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
  expect(cfLoom(project, 'package', '--out', out).status).toBe(0);
  linkPeers(out);
  expect(typeCheck(out).status).toBe(0);
  return out;
}

/** The Contract Package built in a folder of its own, where only its two peers are installed. */
function builtPackage(): string {
  const project = aProject(service);
  const out = join(aFolder(), 'contract-orders-service');
  expect(cfLoom(project, 'package', '--out', out)).toMatchObject({ status: 0, stderr: '' });
  linkPeers(out);
  return out;
}

describe('cf-loom package: the files', () => {
  test('package writes the Contract Package of the Public and Internal Endpoints', () => {
    const project = aProject(service);

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({ status: 0, stdout: 'Wrote contract-package\n', stderr: '' });
    expect(filesIn(join(project, 'contract-package'))).toEqual([
      'package.json',
      'snapshot.json',
      'src',
      'src/endpoints',
      'src/endpoints/get-order.ts',
      'src/endpoints/list-orders.ts',
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

    cfLoom(project, 'package');

    expect(read(project, 'contract-package/src/index.ts')).toMatch(
      /^\/\/ Generated by cf-loom package\. Do not edit\.\n/,
    );
    expect(read(project, 'contract-package/src/guards/permission.ts')).toMatch(
      /^\/\/ Generated by cf-loom package\. Do not edit\.\n/,
    );
  });

  test('package.json names the package after the Service, at 0.0.0, with the two peers as built', () => {
    const project = aProject(service);

    cfLoom(project, 'package');

    expect(JSON.parse(read(project, 'contract-package/package.json'))).toEqual({
      name: '@org/contract-orders-service',
      version: '0.0.0',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist', 'snapshot.json'],
      sideEffects: false,
      peerDependencies: {
        '@casitafeliz/loom-contract': `^${contractVersion}`,
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

    cfLoom(project, 'package');

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

    cfLoom(project, 'package');

    expect(read(project, 'contract-package/snapshot.json')).toBe(
      read(project, 'contract.snapshot.json'),
    );
  });

  test('nothing Private and no Definitions Package is written into the package', () => {
    const project = aProject(service);

    cfLoom(project, 'package');

    const out = join(project, 'contract-package');
    const code = filesIn(out)
      .filter((file) => file.endsWith('.ts') && file !== 'src/snapshot.ts')
      .map((file) => read(out, file))
      .join('\n');
    for (const absent of ['adminOrder', 'apiKey', 'ADMIN_ONLY', 'category', '@org/definitions']) {
      expect(code).not.toContain(absent);
    }
    expect(read(out, 'package.json')).not.toContain('@org/definitions');
  });

  test('the Definitions Package’s Guard and shared schema are written in', () => {
    const project = aProject(service);

    cfLoom(project, 'package');

    expect(read(project, 'contract-package/src/guards/permission.ts')).toContain(
      "z.array(z.enum(['orders:edit', 'orders:read'])).min(1)",
    );
    expect(read(project, 'contract-package/src/endpoints/get-order.ts')).toContain(
      'total: z.object({ amount: z.int(), currency: z.string() })',
    );
  });
  test('every binding is suffixed by its kind, and the entry keys Endpoints by name', () => {
    const project = aProject(service);

    cfLoom(project, 'package');

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
    expect(getOrder).toContain("import * as loom from '@casitafeliz/loom-contract';");
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
    const swapped = (service['src/contract/index.ts'] ?? '')
      .replace(
        "body: z.object({ id: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),",
        "body: z.object({ total: money, status: openEnum(['paid', 'pending']), id: z.uuid() }),",
      )
      .replace('guards: [userToken, permission],', 'guards: [permission, userToken],');
    const first = aProject(service);
    const second = aProject({ ...service, 'src/contract/index.ts': swapped });

    cfLoom(first, 'package');
    cfLoom(second, 'package');

    const out = 'contract-package';
    for (const file of filesIn(join(first, out)).filter((path) => path.includes('.'))) {
      expect(read(second, join(out, file))).toBe(read(first, join(out, file)));
    }
  });
});

describe('cf-loom package: the built package', () => {
  test('tsc builds it with only zod and @casitafeliz/loom-contract installed', () => {
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
      events: {},
      standardRejections: {
        invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
        notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
        notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
      },
    });
    expect(Object.keys(built.contract.endpoints)).toEqual(['getOrder', 'listOrders']);
    expect(built.contract.endpoints.listOrders.lifecycle).toBe('deprecated');
    expect(built.contract.endpoints.getOrder.lifecycle).toBeUndefined();
    expect(built.snapshot).toEqual(JSON.parse(read(out, 'snapshot.json')));
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
        "import { defineApplication, defineDependencies } from '@casitafeliz/loom-contract';",
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

  test('cfLoom.dependencies is in canonical order, whatever order the root lists them in', () => {
    const alpha = aProviderPackage('alpha-service');
    const beta = aProviderPackage('beta-service');
    const applicationOf = (listed: string) => {
      const project = aProject({
        'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
        'cf-loom.config.ts': config,
        'src/contract/index.ts': lines([
          "import { defineApplication, defineDependencies } from '@casitafeliz/loom-contract';",
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

    cfLoom(first, 'package');
    cfLoom(second, 'package');

    expect(read(second, 'contract-package/package.json')).toBe(
      read(first, 'contract-package/package.json'),
    );
    expect(read(first, 'contract-package/package.json')).toMatch(
      /"alpha-service"[\s\S]*"beta-service"/,
    );
  });

  test('an Application’s package exports its Snapshot only, and builds', async () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/web-admin', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/contract/index.ts': lines([
        "import { defineApplication } from '@casitafeliz/loom-contract';",
        "export const application = defineApplication({ name: 'web-admin', dependencies: [] });",
      ]),
    });
    const out = join(aFolder(), 'contract-web-admin');
    expect(cfLoom(project, 'package', '--out', out).status).toBe(0);
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

    const ran = cfLoom(project, 'package');

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
    cfLoom(project, 'package');
    write(project, { 'contract-package/src/endpoints/stale.ts': 'export {};\n' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(0);
    expect(existsSync(join(project, 'contract-package/src/endpoints/stale.ts'))).toBe(false);
  });

  test('an empty folder is written into', () => {
    const project = aProject({ ...service });
    mkdirSync(join(project, 'out'));

    const ran = cfLoom(project, 'package', '--out', 'out');

    expect(ran).toEqual({ status: 0, stdout: 'Wrote out\n', stderr: '' });
    expect(existsSync(join(project, 'out/package.json'))).toBe(true);
  });
  test('a previous output holding a build is replaced', () => {
    const project = aProject(service);
    cfLoom(project, 'package');
    write(project, { 'contract-package/dist/index.js': 'export {};\n' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(0);
    expect(existsSync(join(project, 'contract-package/dist'))).toBe(false);
  });

  test('a previous output holding a file package does not write is refused and kept', () => {
    const project = aProject(service);
    cfLoom(project, 'package');
    write(project, { 'contract-package/notes.txt': 'mine' });

    const ran = cfLoom(project, 'package');

    expect(ran.status).toBe(3);
    expect(read(project, 'contract-package/notes.txt')).toBe('mine');
  });

  test('the project itself is refused, and nothing in it is deleted', () => {
    const project = aProject(service);
    edit(project, 'package.json', (text) => JSON.stringify({ ...JSON.parse(text), cfLoom: {} }));

    const ran = cfLoom(project, 'package', '--out', '.');

    expect(ran.status).toBe(3);
    expect(existsSync(join(project, 'src/contract/index.ts'))).toBe(true);
  });

  test('a symbolic link is refused, not replaced', () => {
    const project = aProject(service);
    cfLoom(project, 'package', '--out', 'real');
    symlinkSync(join(project, 'real'), join(project, 'linked'));

    const ran = cfLoom(project, 'package', '--out', 'linked');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'linked is a symbolic link: package writes a folder of its own\n',
    });
    expect(lstatSync(join(project, 'linked')).isSymbolicLink()).toBe(true);
  });
});

describe('cf-loom package: what it refuses', () => {
  test('a Definitions Package root is a tooling error', () => {
    const project = aProject({
      'package.json': JSON.stringify({ name: '@org/definitions', type: 'module' }),
      'cf-loom.config.ts': config,
      'src/definitions/index.ts': lines([
        "import { defineDefinitions } from '@casitafeliz/loom-contract';",
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

    const ran = cfLoom(project, 'package');

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

    const ran = cfLoom(project, 'package');

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

    const ran = cfLoom(project, 'package');

    expect(ran).toEqual({ status: 3, stdout: '', stderr: `${line}\n` });
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

    const ran = cfLoom(project, 'package');

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
    expect(cfLoom(project, 'package', '--out', out)).toMatchObject({ status: 0, stderr: '' });
    linkPeers(out);

    const built = typeCheck(out);

    expect(built).toEqual({ status: 0, stdout: '' });
  });

  test('package takes no argument but --out', () => {
    const project = aProject(service);

    const ran = cfLoom(project, 'package', 'now');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^package takes no argument\. Usage: /);
  });
});
