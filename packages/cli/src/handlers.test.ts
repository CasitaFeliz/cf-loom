import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
import { afterEach, describe, expect, test } from 'vitest';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const bin = join(cliDir, 'src', 'bin.ts');
const tsc = join(packagesDir, '..', 'node_modules', '.bin', 'tsc');
const projects: string[] = [];

/** Root may read any folder, so a permission test means nothing when run as root. */
const isRoot = process.getuid?.() === 0;

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

/** A project in a temporary directory, with cf-loom, its handlers and zod installed. */
function aProject(files: Readonly<Record<string, string>>): string {
  const project = mkdtempSync(join(tmpdir(), 'cf-loom-handlers-'));
  projects.push(project);
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@casitafeliz/loom-contract'));
  link(join(packagesDir, 'handlers'), join(project, 'node_modules/@casitafeliz/loom-handlers'));
  link(cliDir, join(project, 'node_modules/@casitafeliz/loom-cli'));
  link(realpathSync(join(cliDir, 'node_modules/zod')), join(project, 'node_modules/zod'));
  write(project, files);
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

/** Rewrites one file of a project from what it holds. */
function edit(project: string, path: string, change: (text: string) => string): void {
  write(project, { [path]: change(read(project, path)) });
}

function read(project: string, path: string): string {
  return readFileSync(join(project, path), 'utf8');
}

/** Runs `cf-loom` in the background, so two runs can overlap. */
function cfLoomAsync(project: string, ...args: string[]) {
  return new Promise<{ status: number | null }>((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: project, stdio: 'ignore' });
    child.on('close', (status) => resolve({ status }));
  });
}

function cfLoom(project: string, ...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Every file under a project's `src/`, outside the Contract, sorted. */
function handlerFiles(project: string): readonly string[] {
  const files = readdirSync(join(project, 'src'), { recursive: true, encoding: 'utf8' });
  return files.filter((file) => file.endsWith('.handler.ts')).sort();
}

/** An import line, spelled so the layout check reads no import of this file in it. */
function importOf(imported: string, specifier: string): string {
  return `import ${imported} from '${specifier}';`;
}

function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

const manifest = JSON.stringify({ name: '@org/orders-service', type: 'module' });

const config = lines([
  "import { defineConfig } from '@casitafeliz/loom-cli';",
  '',
  "export const config = defineConfig({ scope: '@org' });",
]);

const apiKeyGuard = lines([
  "import { defineGuard } from '@casitafeliz/loom-contract';",
  "import { z } from 'zod';",
  '',
  'export const apiKey = defineGuard({',
  "  name: 'apiKey',",
  "  description: 'An API key per Caller',",
  "  demands: { headers: z.object({ 'x-api-key': z.string() }) },",
  '  context: z.object({ callerId: z.string() }),',
  '});',
]);

const legacyKeyGuard = lines([
  "import { defineGuard } from '@casitafeliz/loom-contract';",
  '',
  "export const legacyKey = defineGuard({ name: 'legacyKey', description: 'An old key' });",
]);

/** An Endpoint declaration under the Group `orders`, exported as its name. */
function anEndpoint({
  name,
  method = 'GET',
  path,
  visibility = 'public',
  lifecycle = 'active',
  guards = '[]',
  imports = [] as readonly string[],
}: {
  readonly name: string;
  readonly method?: string;
  readonly path: string;
  readonly visibility?: string;
  readonly lifecycle?: string;
  readonly guards?: string;
  readonly imports?: readonly string[];
}): string {
  return lines([
    "import { defineEndpoint } from '@casitafeliz/loom-contract';",
    "import { z } from 'zod';",
    ...imports,
    '',
    `export const ${name} = defineEndpoint({`,
    `  name: '${name}',`,
    `  method: '${method}',`,
    `  path: '${path}',`,
    `  visibility: '${visibility}',`,
    `  description: '${name}',`,
    `  lifecycle: '${lifecycle}',`,
    `  guards: ${guards},`,
    '  success: { status: 200, body: z.object({ id: z.string() }) },',
    '});',
  ]);
}

/** The root, listing the Group `orders` of the given Endpoints, each exported from its file. */
function aRoot(endpoints: Readonly<Record<string, string>>): string {
  const names = Object.keys(endpoints);
  return lines([
    "import { defineContract, defineGroup } from '@casitafeliz/loom-contract';",
    ...names.map((name) => `import { ${name} } from '${endpoints[name]}';`),
    '',
    'const orders = defineGroup({',
    "  name: 'orders',",
    "  description: 'Orders',",
    `  endpoints: [${names.join(', ')}],`,
    '});',
    '',
    "export const contract = defineContract({ name: 'orders-service', groups: [orders] });",
  ]);
}

/**
 * A Service with a Public Endpoint attaching a local Guard, a Private Endpoint, and a Retired
 * Endpoint attaching a Guard only it attaches.
 */
function aService(): Readonly<Record<string, string>> {
  return {
    'package.json': manifest,
    'cf-loom.config.ts': config,
    'src/contract/guards/api-key.guard.ts': apiKeyGuard,
    'src/contract/guards/legacy-key.guard.ts': legacyKeyGuard,
    'src/contract/endpoints/orders/get-order.endpoint.ts': anEndpoint({
      name: 'getOrder',
      path: '/orders/:orderId',
      guards: '[apiKey]',
      imports: ["import { apiKey } from '../../guards/api-key.guard.ts';"],
    }).replace('  success:', '  input: { params: z.object({ orderId: z.string() }) },\n  success:'),
    'src/contract/endpoints/orders/create-order.endpoint.ts': anEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'private',
    }),
    'src/contract/endpoints/orders/list-orders.endpoint.ts': anEndpoint({
      name: 'listOrders',
      path: '/old-orders',
      lifecycle: 'retired',
      guards: '[legacyKey]',
      imports: ["import { legacyKey } from '../../guards/legacy-key.guard.ts';"],
    }),
    'src/contract/index.ts': aRoot({
      getOrder: './endpoints/orders/get-order.endpoint.ts',
      createOrder: './endpoints/orders/create-order.endpoint.ts',
      listOrders: './endpoints/orders/list-orders.endpoint.ts',
    }),
  };
}

const header = '// Generated by cf-loom generate. Do not edit.';

/** The Service, with its Private Endpoint `createOrder` Deprecated. */
function withDeprecatedCreateOrder(): Readonly<Record<string, string>> {
  return {
    ...aService(),
    'src/contract/endpoints/orders/create-order.endpoint.ts': anEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'private',
      lifecycle: 'deprecated',
    }),
  };
}

/** The Service, with `createOrder` attaching the Guard `userToken` of `@org/definitions`. */
function withDefinitionsGuard(): Readonly<Record<string, string>> {
  const service = aService();
  return {
    ...service,
    'node_modules/@org/definitions/package.json': JSON.stringify({
      name: '@org/definitions',
      version: '4.2.0',
      type: 'module',
      exports: './index.js',
    }),
    'node_modules/@org/definitions/index.js': lines([
      "import { defineDefinitions, defineGuard } from '@casitafeliz/loom-contract';",
      "export const userToken = defineGuard({ name: 'userToken', description: 'A user' });",
      "export const definitions = defineDefinitions({ name: 'definitions', guards: [userToken] });",
    ]),
    'src/contract/endpoints/orders/create-order.endpoint.ts': anEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      guards: '[userToken]',
      imports: ["import { userToken } from '@org/definitions';"],
    }),
    'src/contract/index.ts': (service['src/contract/index.ts'] ?? '')
      .replace(
        "import { defineContract, defineGroup } from '@casitafeliz/loom-contract';",
        "import { defineContract, defineGroup } from '@casitafeliz/loom-contract';\nimport { definitions } from '@org/definitions';",
      )
      .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
  };
}

describe('cf-loom generate: the Handler map', () => {
  test('handlers.generated.ts maps every Endpoint and attached Guard that is not Retired, by name', () => {
    const project = aProject(aService());

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/handlers.generated.ts')).toBe(
      lines([
        header,
        importOf('createOrderEndpointHandler', './endpoints/orders/create-order.handler.ts'),
        importOf('getOrderEndpointHandler', './endpoints/orders/get-order.handler.ts'),
        importOf('apiKeyGuardHandler', './guards/api-key.handler.ts'),
        '',
        'export default {',
        '  endpoints: {',
        '    createOrder: createOrderEndpointHandler,',
        '    getOrder: getOrderEndpointHandler,',
        '  },',
        '  guards: {',
        '    apiKey: apiKeyGuardHandler,',
        '  },',
        '  commands: {},',
        '  subscriptions: {},',
        '  deprecatedAt: {},',
        '};',
      ]),
    );
  });

  test('the Handler map carries each live Deprecated Endpoint’s deprecatedAt, from the Snapshot', () => {
    const project = aProject(withDeprecatedCreateOrder());

    cfLoom(project, 'generate');

    const snapshot = JSON.parse(read(project, 'contract.snapshot.json'));
    const stamp: string = snapshot.endpoints['POST /orders'].deprecatedAt;
    expect(read(project, 'src/handlers.generated.ts')).toContain(
      lines(['  deprecatedAt: {', `    createOrder: '${stamp}',`, '  },', '};']),
    );
  });

  test('readers.generated.ts holds no reader while the Service declares no Event', () => {
    const project = aProject(aService());

    cfLoom(project, 'generate');

    expect(read(project, 'src/readers.generated.ts')).toBe(lines([header, 'export {};']));
  });

  test('generate says each file it wrote', () => {
    const project = aProject(aService());

    const ran = cfLoom(project, 'generate');

    expect(ran.stdout).toBe(
      lines([
        'Wrote contract.snapshot.json',
        'Wrote src/handlers.generated.ts',
        'Wrote src/readers.generated.ts',
        'Wrote src/endpoints/orders/create-order.handler.ts',
        'Wrote src/endpoints/orders/get-order.handler.ts',
        'Wrote src/guards/api-key.handler.ts',
      ]),
    );
  });
});

describe('cf-loom generate: stubs', () => {
  test('a stub is written for each missing Handler, importing its Element from where it is exported', () => {
    const project = aProject(aService());

    cfLoom(project, 'generate');

    expect(handlerFiles(project)).toEqual([
      'endpoints/orders/create-order.handler.ts',
      'endpoints/orders/get-order.handler.ts',
      'guards/api-key.handler.ts',
    ]);
    expect(read(project, 'src/endpoints/orders/get-order.handler.ts')).toBe(
      lines([
        "import { handle } from '@casitafeliz/loom-handlers';",
        "import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint.ts';",
        '',
        'export default handle.stub(getOrder);',
      ]),
    );
    expect(read(project, 'src/guards/api-key.handler.ts')).toBe(
      lines([
        "import { handle } from '@casitafeliz/loom-handlers';",
        "import { apiKey } from '../contract/guards/api-key.guard.ts';",
        '',
        'export default handle.stub(apiKey);',
      ]),
    );
  });

  test('an Element exported by several files is imported from the first by code point', () => {
    const project = aProject({
      ...aService(),
      'src/contract/endpoints/orders/index.ts':
        "export { getOrder } from './get-order.endpoint.ts';\n",
    });

    cfLoom(project, 'generate');

    expect(read(project, 'src/endpoints/orders/get-order.handler.ts')).toContain(
      "import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint.ts';",
    );
  });

  test('a Guard of a Definitions Package is imported from the package by its name', () => {
    const project = aProject(withDefinitionsGuard());

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/guards/user-token.handler.ts')).toBe(
      lines([
        "import { handle } from '@casitafeliz/loom-handlers';",
        "import { userToken } from '@org/definitions';",
        '',
        'export default handle.stub(userToken);',
      ]),
    );
  });

  test('a Guard of a Definitions Package is imported from the package, even when a Contract file re-exports it', () => {
    const project = aProject({
      ...withDefinitionsGuard(),
      'src/contract/guards/a-reexport.ts': "export { userToken } from '@org/definitions';\n",
    });

    cfLoom(project, 'generate');

    expect(read(project, 'src/guards/user-token.handler.ts')).toContain(
      "import { userToken } from '@org/definitions';",
    );
  });

  test('an existing Handler is never overwritten, and a second generate changes no byte', () => {
    const project = aProject(aService());
    const written = "export default 'mine';\n";
    write(project, { 'src/guards/api-key.handler.ts': written });
    cfLoom(project, 'generate');
    const map = read(project, 'src/handlers.generated.ts');
    const stub = read(project, 'src/endpoints/orders/get-order.handler.ts');

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/guards/api-key.handler.ts')).toBe(written);
    expect(read(project, 'src/handlers.generated.ts')).toBe(map);
    expect(read(project, 'src/endpoints/orders/get-order.handler.ts')).toBe(stub);
    expect(handlerFiles(project)).toHaveLength(3);
  });
});

describe('cf-loom generate: what it refuses', () => {
  test('an Endpoint exported by no file under src/contract exits 1 naming it, and writes nothing', () => {
    const service = aService();
    const project = aProject({
      ...service,
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '')
        .replace(
          `${importOf('{ createOrder }', './endpoints/orders/create-order.endpoint.ts')}\n`,
          '',
        )
        .replace(
          'const orders = defineGroup({',
          [
            "import { defineEndpoint } from '@casitafeliz/loom-contract';",
            "import { z } from 'zod';",
            'const createOrder = defineEndpoint({',
            "  name: 'createOrder', method: 'POST', path: '/orders', visibility: 'private',",
            "  description: 'createOrder', success: { status: 200, body: z.object({}) },",
            '});',
            'const orders = defineGroup({',
          ].join('\n'),
        ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'endpoints.createOrder is exported by no file under src/contract/\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
    expect(existsSync(join(project, 'src/handlers.generated.ts'))).toBe(false);
  });

  test('an Endpoint exported only under another name exits 1 naming it', () => {
    const service = aService();
    const project = aProject({
      ...service,
      'src/contract/endpoints/orders/create-order.endpoint.ts': (
        service['src/contract/endpoints/orders/create-order.endpoint.ts'] ?? ''
      ).replace('export const createOrder =', 'export const createOrderEndpoint ='),
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '').replace(
        'import { createOrder }',
        'import { createOrderEndpoint as createOrder }',
      ),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'endpoints.createOrder is not exported as createOrder\n',
    });
  });

  test('a local Guard exported by no file exits 1 naming it', () => {
    const service = aService();
    const project = aProject({
      ...service,
      'src/contract/guards/api-key.guard.ts': apiKeyGuard
        .replace('export const apiKey =', 'const apiKey =')
        .concat('export const guards = [apiKey];\n'),
      'src/contract/endpoints/orders/get-order.endpoint.ts': (
        service['src/contract/endpoints/orders/get-order.endpoint.ts'] ?? ''
      )
        .replace('{ apiKey }', '{ guards }')
        .replace('guards: [apiKey]', 'guards: [guards[0]]'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'guards.apiKey is exported by no file under src/contract/\n',
    });
  });

  test('a Guard its Definitions Package exports under another name exits 1 naming it', () => {
    const definitions = withDefinitionsGuard();
    const project = aProject({
      ...definitions,
      'node_modules/@org/definitions/index.js': (
        definitions['node_modules/@org/definitions/index.js'] ?? ''
      )
        .replace('export const userToken =', 'const userToken =')
        .concat('export { userToken as token };\n'),
      'src/contract/endpoints/orders/create-order.endpoint.ts': (
        definitions['src/contract/endpoints/orders/create-order.endpoint.ts'] ?? ''
      ).replace('{ userToken }', '{ token as userToken }'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'guards.userToken is not exported as userToken by @org/definitions\n',
    });
  });

  test('an Endpoint named handle fails the name grammar, since its stub imports handle', () => {
    const service = aService();
    const project = aProject({
      ...service,
      'src/contract/endpoints/orders/create-order.endpoint.ts': anEndpoint({
        name: 'handle',
        method: 'POST',
        path: '/orders',
        visibility: 'private',
      }),
      'src/contract/index.ts': aRoot({
        getOrder: './endpoints/orders/get-order.endpoint.ts',
        handle: './endpoints/orders/create-order.endpoint.ts',
        listOrders: './endpoints/orders/list-orders.endpoint.ts',
      }),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'groups.orders.endpoints.POST /orders.name name-grammar: An Endpoint name is camelCase and no reserved word: handle\n',
    });
  });

  test('a Handler path that is a folder exits 1 naming it', () => {
    const project = aProject({
      ...aService(),
      'src/guards/api-key.handler.ts/kept.txt': '',
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/guards/api-key.handler.ts is no file: a Handler is a file\n',
    });
  });

  test('a Handler file no declared Endpoint or Guard names exits 1 naming it', () => {
    const project = aProject({
      ...aService(),
      'src/guards/old-key.handler.ts': "export default 'old';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "src/guards/old-key.handler.ts names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it\n",
    });
  });

  test('the Handler of a Retired Endpoint that is still declared is no orphan', () => {
    const project = aProject({
      ...aService(),
      'src/endpoints/orders/list-orders.handler.ts': "export default 'retired';\n",
      'src/guards/legacy-key.handler.ts': "export default 'retired';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/handlers.generated.ts')).not.toContain('listOrders');
  });
});

describe('cf-loom generate: roots that offer no Elements', () => {
  test.each([
    [
      'an Application',
      {
        'src/contract/index.ts': lines([
          "import { defineApplication } from '@casitafeliz/loom-contract';",
          "export const application = defineApplication({ name: 'orders-service', dependencies: [] });",
        ]),
      },
    ],
    [
      'a Definitions Package',
      {
        'src/definitions/index.ts': lines([
          "import { defineDefinitions } from '@casitafeliz/loom-contract';",
          "export const definitions = defineDefinitions({ name: 'orders-service' });",
        ]),
      },
    ],
  ])('%s gets only contract.snapshot.json', (_kind, files) => {
    const project = aProject({ 'package.json': manifest, 'cf-loom.config.ts': config, ...files });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({ status: 0, stdout: 'Wrote contract.snapshot.json\n', stderr: '' });
    expect(existsSync(join(project, 'src/handlers.generated.ts'))).toBe(false);
    expect(existsSync(join(project, 'src/readers.generated.ts'))).toBe(false);
  });
});

describe('cf-loom generate: the Service type-checks', () => {
  const tsconfig = JSON.stringify({
    compilerOptions: {
      allowImportingTsExtensions: true,
      module: 'nodenext',
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: 'es2024',
      types: [],
    },
    include: ['src'],
  });

  function typeCheck(project: string) {
    const ran = spawnSync(tsc, ['-p', project], { encoding: 'utf8' });
    return { status: ran.status, stdout: ran.stdout };
  }

  test('the generated Service passes tsc, and a deleted Handler file is a type error', () => {
    const project = aProject({ ...aService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    expect(typeCheck(project)).toEqual({ status: 0, stdout: '' });
    rmSync(join(project, 'src/guards/api-key.handler.ts'));

    const checked = typeCheck(project);

    expect(checked.status).not.toBe(0);
    expect(checked.stdout).toContain('error TS2307');
    expect(checked.stdout).toContain('./guards/api-key.handler.ts');
  });
});

describe('cf-loom verify: the Handler map, readers and Handlers', () => {
  test('verify exits 0 when every generated file is up to date', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 0,
      stdout: lines([
        'contract.snapshot.json is up to date',
        'src/handlers.generated.ts is up to date',
        'src/readers.generated.ts is up to date',
      ]),
      stderr: '',
    });
  });

  test.each(['src/handlers.generated.ts', 'src/readers.generated.ts'])(
    'verify exits 1 when %s was edited',
    (file) => {
      const project = aProject(aService());
      cfLoom(project, 'generate');
      write(project, { [file]: `${read(project, file)}// mine\n` });

      const ran = cfLoom(project, 'verify');

      expect(ran).toEqual({
        status: 1,
        stdout: '',
        stderr: `${file} was edited or is out of date: run cf-loom generate\n`,
      });
    },
  );

  test('verify exits 1 when an Endpoint was added since generate', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    write(project, {
      'src/contract/endpoints/orders/cancel-order.endpoint.ts': anEndpoint({
        name: 'cancelOrder',
        method: 'DELETE',
        path: '/orders',
      }),
      'src/contract/index.ts': aRoot({
        getOrder: './endpoints/orders/get-order.endpoint.ts',
        createOrder: './endpoints/orders/create-order.endpoint.ts',
        listOrders: './endpoints/orders/list-orders.endpoint.ts',
        cancelOrder: './endpoints/orders/cancel-order.endpoint.ts',
      }),
    });

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(
      'src/handlers.generated.ts was edited or is out of date: run cf-loom generate\n',
    );
  });

  test('verify exits 1 when a deprecatedAt in the Snapshot no longer matches the map', () => {
    const project = aProject(withDeprecatedCreateOrder());
    cfLoom(project, 'generate');
    edit(project, 'contract.snapshot.json', (text) =>
      text.replace(/"deprecatedAt": "[^"]+"/, '"deprecatedAt": "2020-01-02T03:04:05Z"'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/handlers.generated.ts was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 1 when a Handler file the map imports is missing', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    rmSync(join(project, 'src/endpoints/orders/get-order.handler.ts'));

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/endpoints/orders/get-order.handler.ts is missing: run cf-loom generate\n',
    });
  });

  test('verify exits 1 on a Handler file no declared Endpoint or Guard names', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    write(project, { 'src/endpoints/orders/old-order.handler.ts': "export default 'old';\n" });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "src/endpoints/orders/old-order.handler.ts names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it\n",
    });
  });

  test('verify exits 1 when a Handler path is a folder', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    rmSync(join(project, 'src/guards/api-key.handler.ts'));
    write(project, { 'src/guards/api-key.handler.ts/kept.txt': '' });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/guards/api-key.handler.ts is no file: a Handler is a file\n',
    });
  });

  test('verify compares files and loads no export, so a renamed export is not its to find', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    edit(project, 'src/contract/endpoints/orders/create-order.endpoint.ts', (text) =>
      text.replace('export const createOrder =', 'export const createOrderEndpoint ='),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace('import { createOrder }', 'import { createOrderEndpoint as createOrder }'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(0);
  });

  test('verify writes nothing', () => {
    const project = aProject(aService());

    cfLoom(project, 'verify');

    expect(existsSync(join(project, 'src/handlers.generated.ts'))).toBe(false);
    expect(existsSync(join(project, 'src/readers.generated.ts'))).toBe(false);
    expect(handlerFiles(project)).toEqual([]);
  });
});

describe('cf-loom: options', () => {
  test('--out is refused for a command other than package', () => {
    const project = aProject(aService());

    const ran = cfLoom(project, 'generate', '--out', 'elsewhere');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^Only package takes --out\. Usage: /);
  });
});

describe('cf-loom generate: linked folders and other runs', () => {
  test('a Guard exported behind a linked src/contract/guards gets its stub', () => {
    const service = aService();
    const project = aProject({
      ...service,
      'shared/guards/api-key.guard.ts': apiKeyGuard,
      'shared/guards/legacy-key.guard.ts': legacyKeyGuard,
    });
    rmSync(join(project, 'src/contract/guards'), { recursive: true });
    symlinkSync(join(project, 'shared/guards'), join(project, 'src/contract/guards'), 'dir');

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/guards/api-key.handler.ts')).toContain(
      "import { apiKey } from '../contract/guards/api-key.guard.ts';",
    );
  });

  test('an orphan Handler behind a linked folder exits 1 naming it', () => {
    const project = aProject({
      ...aService(),
      'elsewhere/old.handler.ts': "export default 'old';\n",
    });
    mkdirSync(join(project, 'src/endpoints'), { recursive: true });
    symlinkSync(join(project, 'elsewhere'), join(project, 'src/endpoints/other'), 'dir');

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "src/endpoints/other/old.handler.ts names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it\n",
    });
  });

  test('a link back up does not loop', () => {
    const project = aProject(aService());
    mkdirSync(join(project, 'src/endpoints'), { recursive: true });
    symlinkSync(join(project, 'src'), join(project, 'src/endpoints/up'), 'dir');

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
  });

  test('two generate runs at once both complete, each keeping the other’s stubs', async () => {
    const project = aProject(aService());

    const ran = await Promise.all([
      cfLoomAsync(project, 'generate'),
      cfLoomAsync(project, 'generate'),
    ]);

    expect(ran.map(({ status }) => status)).toEqual([0, 0]);
    expect(cfLoom(project, 'verify').status).toBe(0);
  });

  test('a file under src/contract the root does not import that cannot be loaded is a tooling error', () => {
    const project = aProject({ ...aService(), 'src/contract/broken.ts': 'export const = ;\n' });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^src\/contract\/broken\.ts cannot be loaded: [^\n]+\n$/);
  });

  test.each(['generate', 'verify'])('%s takes no argument', (command) => {
    const project = aProject(aService());

    const ran = cfLoom(project, command, 'now');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(new RegExp(`^${command} takes no argument\\. Usage: `));
  });
});

describe('cf-loom generate and verify: what the file system holds', () => {
  test.skipIf(isRoot)(
    'a regenerated file that cannot be read fails verify in one line (skipped as root)',
    () => {
      const project = aProject(aService());
      cfLoom(project, 'generate');
      chmodSync(join(project, 'src/handlers.generated.ts'), 0o000);

      const ran = cfLoom(project, 'verify');

      chmodSync(join(project, 'src/handlers.generated.ts'), 0o644);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^src\/handlers\.generated\.ts cannot be read: EACCES[^\n]*\n$/);
    },
  );

  test('a folder where the Handler map goes fails verify in one line', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    rmSync(join(project, 'src/handlers.generated.ts'));
    mkdirSync(join(project, 'src/handlers.generated.ts'));

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/handlers.generated.ts was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('src/guards that is a file fails generate, which writes the rest, and verify, in one line each', () => {
    const project = aProject({ ...aService(), 'src/guards': 'mine' });

    const generated = cfLoom(project, 'generate');
    const verified = cfLoom(project, 'verify');

    expect(generated.status).toBe(3);
    expect(generated.stderr).toBe(
      "src/guards/api-key.handler.ts cannot be written: EEXIST: file already exists, mkdir 'src/guards'\n",
    );
    expect(verified.status).toBe(1);
    expect(verified.stderr).toBe(
      'src/guards/api-key.handler.ts is missing: run cf-loom generate\n',
    );
  });

  test('a dangling link at a Handler path is no file', () => {
    const project = aProject(aService());
    mkdirSync(join(project, 'src/guards'), { recursive: true });
    symlinkSync(join(project, 'nowhere'), join(project, 'src/guards/api-key.handler.ts'));

    const generated = cfLoom(project, 'generate');
    const verified = cfLoom(project, 'verify');

    expect(generated).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/guards/api-key.handler.ts is no file: a Handler is a file\n',
    });
    expect(verified.stderr).toContain(
      'src/guards/api-key.handler.ts is no file: a Handler is a file\n',
    );
  });

  test('a folder where the Handler map goes is a tooling error in one line', () => {
    const project = aProject({ ...aService(), 'src/handlers.generated.ts/kept.txt': '' });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^src\/handlers\.generated\.ts cannot be written: [^\n]+\n$/);
  });

  test.each(['src/endpoints', 'src/guards'])(
    '%s that is a file is a tooling error in one line',
    (path) => {
      const project = aProject({ ...aService(), [path]: 'mine' });

      const ran = cfLoom(project, 'generate');

      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^[^\n]+ cannot be written: [^\n]+\n$/);
    },
  );

  test.skipIf(isRoot)(
    'an unreadable folder under the Handlers is a tooling error in one line (skipped as root)',
    () => {
      const project = aProject({ ...aService(), 'src/endpoints/private/kept.txt': '' });
      chmodSync(join(project, 'src/endpoints/private'), 0o000);

      const generated = cfLoom(project, 'generate');
      const verified = cfLoom(project, 'verify');

      chmodSync(join(project, 'src/endpoints/private'), 0o755);
      expect(generated.status).toBe(3);
      expect(generated.stderr).toMatch(/^src\/endpoints\/private cannot be read: EACCES[^\n]*\n$/);
      expect(verified.status).toBe(3);
      expect(verified.stderr).toMatch(/^src\/endpoints\/private cannot be read: EACCES[^\n]*\n$/);
    },
  );

  test.skipIf(isRoot)(
    'an unreadable folder under src/contract is a tooling error in one line (skipped as root)',
    () => {
      const project = aProject({ ...aService(), 'src/contract/locked/kept.txt': '' });
      chmodSync(join(project, 'src/contract/locked'), 0o000);

      const ran = cfLoom(project, 'generate');

      chmodSync(join(project, 'src/contract/locked'), 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^src\/contract\/locked cannot be read: EACCES[^\n]*\n$/);
    },
  );

  test('init takes one kind', () => {
    const project = aProject({ 'package.json': manifest });

    const ran = cfLoom(project, 'init', 'service', 'application');

    expect(ran.status).toBe(3);
    expect(ran.stderr).toMatch(/^init takes one kind\. Usage: /);
  });
});
