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
import { payments } from '../test/payments-package.ts';

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
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@cf-loom/contract'));
  link(join(packagesDir, 'handlers'), join(project, 'node_modules/@cf-loom/handlers'));
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
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
  "import { defineConfig } from '@cf-loom/cli';",
  '',
  "export const config = defineConfig({ scope: '@org' });",
]);

/** A `cf-loom.config.ts` setting `layout` to the source text given, as its author wrote it. */
function configWith(layout: string): string {
  return lines([
    "import { defineConfig } from '@cf-loom/cli';",
    '',
    `export const config = defineConfig({ scope: '@org', layout: ${layout} });`,
  ]);
}

/** The files of a Service, its config setting `layout` to the source text given. */
function withLayout(
  files: Readonly<Record<string, string>>,
  layout: string,
): Readonly<Record<string, string>> {
  return { ...files, 'cf-loom.config.ts': configWith(layout) };
}

/** A layout that moves every Handler and both generated files. */
const movedLayout = lines([
  '{',
  "  endpoint: 'src/http/{group}/{name}.handler.ts',",
  "  guard: 'src/security/{name}.handler.ts',",
  "  command: 'src/billing/{name}.v{version}.handler.ts',",
  "  subscription: 'src/reactions/{name}.handler.ts',",
  "  handlerMap: 'src/generated/handlers.generated.ts',",
  "  readers: 'src/generated/readers.generated.ts',",
  '}',
]).trimEnd();

/** Every file a command left under `src/` outside the Contract, and the Snapshot, with its text. */
function writtenBy(project: string): Readonly<Record<string, string>> {
  const entries = readdirSync(join(project, 'src'), { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(project.length + 1))
    .filter((path) => !path.startsWith('src/contract/'));
  return Object.fromEntries(
    ['contract.snapshot.json', ...files].map((path) => [path, read(project, path)]),
  );
}

/** The line `generate` and `verify` print for a Handler file nothing declared names. */
function orphanLine(path: string): string {
  return `${path} names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it`;
}

const apiKeyGuard = lines([
  "import { defineGuard } from '@cf-loom/contract';",
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
  "import { defineGuard } from '@cf-loom/contract';",
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
    "import { defineEndpoint } from '@cf-loom/contract';",
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
    "import { defineContract, defineGroup } from '@cf-loom/contract';",
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
      "import { defineDefinitions, defineGuard } from '@cf-loom/contract';",
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
        "import { defineContract, defineGroup } from '@cf-loom/contract';",
        "import { defineContract, defineGroup } from '@cf-loom/contract';\nimport { definitions } from '@org/definitions';",
      )
      .replace("name: 'orders-service',", "name: 'orders-service', definitions: [definitions],"),
  };
}

/** The Service with an Endpoint named `apiKey`, as its Guard is. */
function withEndpointNamedLikeGuard(): Readonly<Record<string, string>> {
  return {
    ...aService(),
    'src/contract/endpoints/orders/api-key.endpoint.ts': anEndpoint({
      name: 'apiKey',
      path: '/api-key',
      guards: '[apiKeyGuard]',
      imports: ["import { apiKey as apiKeyGuard } from '../../guards/api-key.guard.ts';"],
    }),
    'src/contract/index.ts': aRoot({ apiKey: './endpoints/orders/api-key.endpoint.ts' }),
  };
}

/** Every file under a folder of a project, by its path from the folder, with its text. */
function treeOf(project: string, folder: string): Readonly<Record<string, string>> {
  const entries = readdirSync(join(project, folder), { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(join(project, folder).length + 1));
  return Object.fromEntries(paths.map((path) => [path, read(project, join(folder, path))]));
}

const messages = lines([
  "import { defineCommand, defineEvent, openEnum } from '@cf-loom/contract';",
  "import { z } from 'zod';",
  '',
  'const tree = z',
  '  .object({',
  '    label: z.string(),',
  '    get children() {',
  '      return z.array(tree);',
  '    },',
  '  })',
  "  .meta({ id: 'tree' });",
  '',
  'export const orderCreatedV1 = defineEvent({',
  "  name: 'OrderCreated',",
  '  version: 1,',
  "  visibility: 'internal',",
  "  description: 'An order was placed',",
  "  lifecycle: 'deprecated',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
  '',
  'export const orderCreatedV2 = defineEvent({',
  "  name: 'OrderCreated',",
  '  version: 2,',
  "  visibility: 'internal',",
  "  description: 'An order was placed',",
  "  body: z.object({ orderId: z.uuid(), status: openEnum(['pending', 'paid']), items: tree }),",
  '});',
  '',
  'export const orderPurgedV1 = defineEvent({',
  "  name: 'OrderPurged',",
  '  version: 1,',
  "  visibility: 'private',",
  "  description: 'An order was purged',",
  "  lifecycle: 'retired',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
  '',
  'export const chargeCardV1 = defineCommand({',
  "  name: 'ChargeCard',",
  '  version: 1,',
  "  description: 'Charge a card',",
  "  lifecycle: 'deprecated',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
  '',
  'export const chargeCardV2 = defineCommand({',
  "  name: 'ChargeCard',",
  '  version: 2,',
  "  description: 'Charge a card',",
  '  body: z.object({ orderId: z.uuid(), cents: z.int() }),',
  '});',
  '',
  'export const refundCardV1 = defineCommand({',
  "  name: 'RefundCard',",
  '  version: 1,',
  "  description: 'Refund a card',",
  "  lifecycle: 'retired',",
  '  body: z.object({ orderId: z.uuid() }),',
  '});',
]);

/** The Subscriptions every messaging root lists, each exported under its name in code. */
const subscriptions = lines([
  "import { defineSubscription } from '@cf-loom/contract';",
  "import { orderCreatedV2 } from './messages.ts';",
  "import { paymentSettledV1 } from './payments.ts';",
  '',
  'export const notifyOnSettled = defineSubscription({',
  "  name: 'notifyOnSettled',",
  "  description: 'Notify on settled',",
  '  event: paymentSettledV1,',
  '});',
  '',
  'export const auditCreated = defineSubscription({',
  "  name: 'auditCreated',",
  "  description: 'Audit created',",
  '  event: orderCreatedV2,',
  '});',
]);

/** A Subscription to `OrderCreated@2` written where the root lists it, so no file exports it. */
function inlineSubscription(name: string): string {
  return `defineSubscription({ name: '${name}', description: 'Name', event: orderCreatedV2 })`;
}

/** What a messaging root lists beside its Group, each line one of `defineContract`'s fields. */
type MessagingLists = {
  readonly commands?: string;
  readonly subscriptions?: readonly string[];
};

/**
 * The root of `aService()`, also listing its Events and Commands, and the Subscriptions of
 * `subscriptions.ts`: one to a Dependency's Event, then one to its own `OrderCreated@2`.
 */
function aMessagingRoot({
  commands = '[chargeCardV1, chargeCardV2, refundCardV1]',
  subscriptions = ['notifyOnSettled', 'auditCreated'],
}: MessagingLists = {}): string {
  const root = aService()['src/contract/index.ts'] ?? '';
  return root
    .replace(
      "import { defineContract, defineGroup } from '@cf-loom/contract';",
      lines([
        'import {',
        '  defineContract,',
        '  defineDependencies,',
        '  defineGroup,',
        '  defineSubscription,',
        "} from '@cf-loom/contract';",
        'import {',
        '  chargeCardV1,',
        '  chargeCardV2,',
        '  orderCreatedV1,',
        '  orderCreatedV2,',
        '  orderPurgedV1,',
        '  refundCardV1,',
        "} from './messages.ts';",
        "import { paymentSettledV1, payments } from './payments.ts';",
        "import { auditCreated, notifyOnSettled } from './subscriptions.ts';",
      ]).trimEnd(),
    )
    .replace(
      "export const contract = defineContract({ name: 'orders-service', groups: [orders] });",
      lines([
        'const paymentsDeps = defineDependencies(payments, { events: [paymentSettledV1] });',
        '',
        'export const contract = defineContract({',
        "  name: 'orders-service',",
        '  groups: [orders],',
        '  events: [orderCreatedV1, orderCreatedV2, orderPurgedV1],',
        `  commands: ${commands},`,
        `  subscriptions: [${subscriptions.join(', ')}],`,
        '  dependencies: [paymentsDeps],',
        '});',
      ]).trimEnd(),
    );
}

/**
 * `aService()` with Messages: Events `OrderCreated@1` (Deprecated), `OrderCreated@2` (an Open Enum
 * and a recursive def) and `OrderPurged@1` (Retired); Commands `ChargeCard@1` (Deprecated),
 * `ChargeCard@2` and `RefundCard@1` (Retired); and two Subscriptions, each in `subscriptions.ts`.
 */
function aMessagingService(lists: MessagingLists = {}): Readonly<Record<string, string>> {
  return {
    ...aService(),
    'src/contract/messages.ts': messages,
    'src/contract/payments.ts': payments,
    'src/contract/subscriptions.ts': subscriptions,
    'src/contract/index.ts': aMessagingRoot(lists),
  };
}

/** Runs a module in Node from the project's folder and returns what it logs as JSON. */
function probe(project: string, script: string): unknown {
  const ran = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: project,
    encoding: 'utf8',
  });
  if (ran.status !== 0) {
    throw new Error(ran.stderr);
  }
  return JSON.parse(ran.stdout);
}

/** The probe's import of a module of the project, by its path from the project's folder. */
function probeImportOf(local: string, path: string): string {
  return `const ${local} = await import(${JSON.stringify(`./${path}`)});`;
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
        importOf('{ readers }', './readers.generated.ts'),
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
        '  readers,',
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

  test('readers.generated.ts pairs nothing while the Service declares no Message, and the Handler map still imports its readers', () => {
    const project = aProject(aService());

    cfLoom(project, 'generate');

    expect(read(project, 'src/readers.generated.ts')).toBe(
      lines([
        header,
        "import { readersOf } from '@cf-loom/handlers';",
        '',
        'export const readers = readersOf({',
        '  commands: {},',
        '  subscriptions: {},',
        '});',
      ]),
    );
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
  test('commands are keyed by name in code and subscriptions by name, both unquoted; a Retired Command’s Message Version is left out', () => {
    const project = aProject(aMessagingService());

    cfLoom(project, 'generate');

    expect(read(project, 'src/handlers.generated.ts')).toBe(
      lines([
        header,
        importOf('chargeCardV1CommandHandler', './commands/charge-card.v1.handler.ts'),
        importOf('chargeCardV2CommandHandler', './commands/charge-card.v2.handler.ts'),
        importOf('createOrderEndpointHandler', './endpoints/orders/create-order.handler.ts'),
        importOf('getOrderEndpointHandler', './endpoints/orders/get-order.handler.ts'),
        importOf('apiKeyGuardHandler', './guards/api-key.handler.ts'),
        importOf('{ readers }', './readers.generated.ts'),
        importOf('auditCreatedSubscriptionHandler', './subscriptions/audit-created.handler.ts'),
        importOf(
          'notifyOnSettledSubscriptionHandler',
          './subscriptions/notify-on-settled.handler.ts',
        ),
        '',
        'export default {',
        '  endpoints: {',
        '    createOrder: createOrderEndpointHandler,',
        '    getOrder: getOrderEndpointHandler,',
        '  },',
        '  guards: {',
        '    apiKey: apiKeyGuardHandler,',
        '  },',
        '  commands: {',
        '    chargeCardV1: chargeCardV1CommandHandler,',
        '    chargeCardV2: chargeCardV2CommandHandler,',
        '  },',
        '  subscriptions: {',
        '    auditCreated: auditCreatedSubscriptionHandler,',
        '    notifyOnSettled: notifyOnSettledSubscriptionHandler,',
        '  },',
        '  readers,',
        '  deprecatedAt: {},',
        '};',
      ]),
    );
  });

  test('generate says each file it wrote, the Message Handlers’ stubs included', () => {
    const project = aProject(aMessagingService());

    const ran = cfLoom(project, 'generate');

    expect(ran.stdout).toBe(
      lines([
        'Wrote contract.snapshot.json',
        'Wrote src/handlers.generated.ts',
        'Wrote src/readers.generated.ts',
        'Wrote src/commands/charge-card.v1.handler.ts',
        'Wrote src/commands/charge-card.v2.handler.ts',
        'Wrote src/endpoints/orders/create-order.handler.ts',
        'Wrote src/endpoints/orders/get-order.handler.ts',
        'Wrote src/guards/api-key.handler.ts',
        'Wrote src/subscriptions/audit-created.handler.ts',
        'Wrote src/subscriptions/notify-on-settled.handler.ts',
      ]),
    );
  });
});
describe('cf-loom generate: readers.generated.ts', () => {
  test('it writes a Reader for each own Event and Command Message Version, a Retired Event excepted, in code point order', () => {
    const project = aProject(aMessagingService());

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    expect(read(project, 'src/readers.generated.ts')).toBe(
      lines([
        header,
        importOf(
          '{ chargeCardV1 as chargeCardV1Command, chargeCardV2 as chargeCardV2Command, refundCardV1 as refundCardV1Command }',
          './contract/messages.ts',
        ),
        importOf(
          '{ auditCreated as auditCreatedSubscription, notifyOnSettled as notifyOnSettledSubscription }',
          './contract/subscriptions.ts',
        ),
        "import * as loom from '@cf-loom/contract';",
        "import { readersOf } from '@cf-loom/handlers';",
        "import { z } from 'zod';",
        '',
        'export type TreeReaderDef = { children: Array<TreeReaderDef>; label: string };',
        'export const treeReaderDef: z.ZodType<TreeReaderDef> & z.core.$ZodTypeDiscriminable = z.lazy(() => z.object({ children: z.array(treeReaderDef), label: z.string() }));',
        '',
        'export const chargeCardV1Reader = z.object({ orderId: z.uuid() });',
        'export const chargeCardV2Reader = z.object({ cents: z.int(), orderId: z.uuid() });',
        'export const orderCreatedV1Reader = z.object({ orderId: z.uuid() });',
        "export const orderCreatedV2Reader = z.object({ items: treeReaderDef, orderId: z.uuid(), status: loom.openEnumReader(['paid', 'pending']) });",
        'export const refundCardV1Reader = z.object({ orderId: z.uuid() });',
        '',
        'export const readers = readersOf({',
        '  commands: {',
        '    chargeCardV1: { element: chargeCardV1Command, reader: chargeCardV1Reader },',
        '    chargeCardV2: { element: chargeCardV2Command, reader: chargeCardV2Reader },',
        '    refundCardV1: { element: refundCardV1Command, reader: refundCardV1Reader },',
        '  },',
        '  subscriptions: {',
        '    auditCreated: { element: auditCreatedSubscription, reader: orderCreatedV2Reader },',
        '    notifyOnSettled: { element: notifyOnSettledSubscription, reader: notifyOnSettledSubscription.event.body },',
        '  },',
        '});',
      ]),
    );
  });

  test('a Reader opens every object and reads an unknown Open Enum value as its Unknown case', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    const body = {
      orderId: '0b8f5f8e-8a5e-4c1e-9d0c-2f3b8c1d2e3f',
      status: 'refunded',
      items: { label: 'root', children: [], extra: true },
      extra: 1,
    };

    const parsed = probe(
      project,
      lines([
        probeImportOf('generated', 'src/readers.generated.ts'),
        `const body = generated.orderCreatedV2Reader.parse(${JSON.stringify(body)});`,
        'console.log(JSON.stringify(body));',
      ]),
    );

    expect(parsed).toEqual({
      orderId: body.orderId,
      status: { unknown: 'refunded' },
      items: { label: 'root', children: [] },
    });
  });

  test('each Command’s Message Version is paired with its Reader through the file that exports it', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');

    const paired = probe(
      project,
      lines([
        probeImportOf('generated', 'src/readers.generated.ts'),
        probeImportOf('messages', 'src/contract/messages.ts'),
        'const { chargeCardV2 } = generated.readers.commands;',
        'console.log(JSON.stringify([',
        '  chargeCardV2.element === messages.chargeCardV2,',
        '  chargeCardV2.reader === generated.chargeCardV2Reader,',
        ']));',
      ]),
    );

    expect(paired).toEqual([true, true]);
  });

  test('a Subscription to the Service’s own Event is paired with that Event’s Reader through the file that exports it', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');

    const paired = probe(
      project,
      lines([
        probeImportOf('generated', 'src/readers.generated.ts'),
        probeImportOf('subscriptions', 'src/contract/subscriptions.ts'),
        'const { auditCreated } = generated.readers.subscriptions;',
        'console.log(JSON.stringify([',
        '  auditCreated.element === subscriptions.auditCreated,',
        '  auditCreated.reader === generated.orderCreatedV2Reader,',
        ']));',
      ]),
    );

    expect(paired).toEqual([true, true]);
  });

  test('a Subscription to a Dependency’s Event is paired with that Event’s body', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');

    const paired = probe(
      project,
      lines([
        probeImportOf('generated', 'src/readers.generated.ts'),
        probeImportOf('payments', 'src/contract/payments.ts'),
        'const { notifyOnSettled } = generated.readers.subscriptions;',
        'console.log(JSON.stringify([',
        "  notifyOnSettled.element.name === 'notifyOnSettled',",
        '  notifyOnSettled.reader === payments.paymentSettledV1.body,',
        ']));',
      ]),
    );

    expect(paired).toEqual([true, true]);
  });

  test('a Command’s Message Version is imported from the file that exports it', () => {
    const project = aProject(aMessagingService({ commands: '[chargeCardV1, shipOrderV1]' }));
    write(project, {
      'src/contract/commands/ship-order.v1.command.ts': lines([
        "import { defineCommand } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        '',
        'export const shipOrderV1 = defineCommand({',
        "  name: 'ShipOrder',",
        '  version: 1,',
        "  description: 'Ship an order',",
        '  body: z.object({ orderId: z.uuid() }),',
        '});',
      ]),
    });
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace(
        'import { auditCreated,',
        `${importOf('{ shipOrderV1 }', './commands/ship-order.v1.command.ts')}\nimport { auditCreated,`,
      ),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/readers.generated.ts')).toContain(
      importOf(
        '{ shipOrderV1 as shipOrderV1Command }',
        './contract/commands/ship-order.v1.command.ts',
      ),
    );
  });

  test('a Subscription is imported from the file that exports it', () => {
    const project = aProject(
      aMessagingService({ subscriptions: ['notifyOnSettled', 'auditOrders'] }),
    );
    write(project, {
      'src/contract/subscriptions/audit-orders.subscription.ts': lines([
        "import { defineSubscription } from '@cf-loom/contract';",
        "import { orderCreatedV2 } from '../messages.ts';",
        '',
        'export const auditOrders = defineSubscription({',
        "  name: 'auditOrders',",
        "  description: 'Audit orders',",
        '  event: orderCreatedV2,',
        '});',
      ]),
    });
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace(
        'import { auditCreated,',
        `${importOf('{ auditOrders }', './subscriptions/audit-orders.subscription.ts')}\nimport { auditCreated,`,
      ),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/readers.generated.ts')).toContain(
      importOf(
        '{ auditOrders as auditOrdersSubscription }',
        './contract/subscriptions/audit-orders.subscription.ts',
      ),
    );
  });

  test('a recursive def an own Message reaches is declared once in readers.generated.ts, as a reader, with its type', () => {
    const project = aProject(aMessagingService());

    cfLoom(project, 'generate');

    const text = read(project, 'src/readers.generated.ts');
    expect(text.match(/^export type \w+/gm)).toEqual(['export type TreeReaderDef']);
    expect(text.match(/^export const \w+Def\b/gm)).toEqual(['export const treeReaderDef']);
  });

  test('a recursive def an own Message reaches imports what it calls, though no Reader calls it itself', () => {
    const project = aProject(aMessagingService());
    edit(project, 'src/contract/messages.ts', (text) =>
      text
        .replace("status: openEnum(['pending', 'paid'])", 'status: z.string()')
        .replace('    label: z.string(),', "    label: openEnum(['leaf', 'branch']),"),
    );

    cfLoom(project, 'generate');

    const text = read(project, 'src/readers.generated.ts');
    expect(text).toContain("label: loom.openEnumReader(['branch', 'leaf'])");
    expect(text).toContain("import * as loom from '@cf-loom/contract';");
  });

  test('Commands are paired in code point order of their names in code, whatever the root’s order', () => {
    const project = aProject(
      aMessagingService({ commands: '[shipOrderV10, shipV1, shipOrderV1]' }),
    );
    const ship = (name: string, version: number, lifecycle = 'active') =>
      lines([
        `export const ${name.charAt(0).toLowerCase()}${name.slice(1)}V${version} = defineCommand({`,
        `  name: '${name}',`,
        `  version: ${version},`,
        `  description: '${name}',`,
        `  lifecycle: '${lifecycle}',`,
        '  body: z.object({ orderId: z.uuid() }),',
        '});',
      ]);
    edit(project, 'src/contract/messages.ts', (text) =>
      [text, ship('Ship', 1), ship('ShipOrder', 1, 'deprecated'), ship('ShipOrder', 10)].join('\n'),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace(
        '  refundCardV1,\n',
        '  refundCardV1,\n  shipOrderV1,\n  shipOrderV10,\n  shipV1,\n',
      ),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
    const map = read(project, 'src/handlers.generated.ts');
    const readers = read(project, 'src/readers.generated.ts');
    expect(map.match(/^ {4}\w+: \w+CommandHandler,$/gm)).toEqual([
      '    shipOrderV1: shipOrderV1CommandHandler,',
      '    shipOrderV10: shipOrderV10CommandHandler,',
      '    shipV1: shipV1CommandHandler,',
    ]);
    expect(readers.match(/^ {4}ship\w+: \{ element: \w+Command,/gm)).toEqual([
      '    shipOrderV1: { element: shipOrderV1Command,',
      '    shipOrderV10: { element: shipOrderV10Command,',
      '    shipV1: { element: shipV1Command,',
    ]);
  });

  test('a Retired Command’s Message Version is still imported and paired, so its Handler keeps compiling', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');

    const paired = probe(
      project,
      lines([
        probeImportOf('generated', 'src/readers.generated.ts'),
        probeImportOf('messages', 'src/contract/messages.ts'),
        'const { refundCardV1 } = generated.readers.commands;',
        'console.log(JSON.stringify(refundCardV1.element === messages.refundCardV1));',
      ]),
    );

    expect(paired).toBe(true);
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
        "import { handle } from '@cf-loom/handlers';",
        "import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint.ts';",
        '',
        'export default handle.stub(getOrder);',
      ]),
    );
    expect(read(project, 'src/guards/api-key.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
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
        "import { handle } from '@cf-loom/handlers';",
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
  test('a Command’s Message Version’s stub sits at src/commands/<name>.v<n>.handler.ts and imports its pairing from readers.generated.ts', () => {
    const project = aProject(aMessagingService());

    cfLoom(project, 'generate');

    expect(read(project, 'src/commands/charge-card.v2.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { readers } from '../readers.generated.ts';",
        '',
        'export default handle.stub(readers.commands.chargeCardV2);',
      ]),
    );
  });

  test('a Subscription’s stub sits at src/subscriptions/<name in kebab-case>.handler.ts and imports its pairing from readers.generated.ts', () => {
    const project = aProject(aMessagingService());

    cfLoom(project, 'generate');

    expect(read(project, 'src/subscriptions/notify-on-settled.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { readers } from '../readers.generated.ts';",
        '',
        'export default handle.stub(readers.subscriptions.notifyOnSettled);',
      ]),
    );
  });

  test('no stub is written for a Retired Command’s Message Version', () => {
    const project = aProject(aMessagingService());

    cfLoom(project, 'generate');

    expect(existsSync(join(project, 'src/commands/refund-card.v1.handler.ts'))).toBe(false);
  });

  test('a Command stub’s direct call reads its body with the generated Reader first, then throws, since consume never runs it', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    const meta = { messageId: 'm-1', factId: 'f-1', deliveryCount: 1 };
    const valid = { orderId: '0b8f5f8e-8a5e-4c1e-9d0c-2f3b8c1d2e3f', cents: 100 };

    const thrown = probe(
      project,
      lines([
        probeImportOf('stub', 'src/commands/charge-card.v2.handler.ts'),
        'const nameOf = (call) => call.then(() => "none", (error) => error.constructor.name);',
        'const messageOf = (call) => call.then(() => "none", (error) => error.message);',
        `const meta = ${JSON.stringify(meta)};`,
        'console.log(JSON.stringify([',
        `  await nameOf(stub.default({ orderId: 'no uuid', cents: 100 }, meta)),`,
        `  await messageOf(stub.default(${JSON.stringify(valid)}, meta)),`,
        ']));',
      ]),
    );

    expect(thrown).toEqual([
      'InvalidInputError',
      expect.stringContaining('is a stub, which consume never runs'),
    ]);
  });
});

/** Each test here runs cf-loom generate, some cf-loom package too, which take seconds on a CI runner with shared cores. */
const layoutTimeout = 60_000;

describe('cf-loom generate: a configured layout', { timeout: layoutTimeout }, () => {
  test('an empty layout writes exactly the files of no layout', () => {
    const plain = aProject(aService());
    const laidOut = aProject(withLayout(aService(), '{}'));

    cfLoom(plain, 'generate');
    cfLoom(laidOut, 'generate');

    expect(writtenBy(laidOut)).toEqual(writtenBy(plain));
  });

  test('an Endpoint’s stub is written where layout.endpoint puts it, from its Group and name', () => {
    const project = aProject(
      withLayout(aService(), "{ endpoint: 'src/http/{group}/{name}.handler.ts' }"),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/http/orders/get-order.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint.ts';",
        '',
        'export default handle.stub(getOrder);',
      ]),
    );
  });

  test('a Guard’s stub is written where layout.guard puts it', () => {
    const project = aProject(withLayout(aService(), "{ guard: 'src/security/{name}.handler.ts' }"));

    cfLoom(project, 'generate');

    expect(read(project, 'src/security/api-key.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { apiKey } from '../contract/guards/api-key.guard.ts';",
        '',
        'export default handle.stub(apiKey);',
      ]),
    );
  });

  test('a Command’s Message Version’s stub is written with its version, importing its pairing from the configured readers', () => {
    const project = aProject(
      withLayout(
        aMessagingService(),
        `{
          command: 'src/billing/{name}.v{version}.handler.ts',
          readers: 'src/generated/readers.generated.ts',
        }`,
      ),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/billing/charge-card.v2.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { readers } from '../generated/readers.generated.ts';",
        '',
        'export default handle.stub(readers.commands.chargeCardV2);',
      ]),
    );
  });

  test('a Subscription’s stub is written where layout.subscription puts it', () => {
    const project = aProject(
      withLayout(aMessagingService(), "{ subscription: 'src/reactions/{name}.handler.ts' }"),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/reactions/notify-on-settled.handler.ts')).toBe(
      lines([
        "import { handle } from '@cf-loom/handlers';",
        "import { readers } from '../readers.generated.ts';",
        '',
        'export default handle.stub(readers.subscriptions.notifyOnSettled);',
      ]),
    );
  });

  test('the Handler map at layout.handlerMap imports each Handler relative to itself', () => {
    const project = aProject(
      withLayout(
        aService(),
        `{
          endpoint: 'src/http/{group}/{name}.handler.ts',
          handlerMap: 'src/generated/handlers.generated.ts',
        }`,
      ),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/generated/handlers.generated.ts')).toBe(
      lines([
        header,
        importOf('apiKeyGuardHandler', '../guards/api-key.handler.ts'),
        importOf('createOrderEndpointHandler', '../http/orders/create-order.handler.ts'),
        importOf('getOrderEndpointHandler', '../http/orders/get-order.handler.ts'),
        importOf('{ readers }', '../readers.generated.ts'),
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
        '  readers,',
        '  deprecatedAt: {},',
        '};',
      ]),
    );
  });

  test('the readers at layout.readers import the Contract relative to themselves', () => {
    const project = aProject(
      withLayout(aMessagingService(), "{ readers: 'src/generated/readers.generated.ts' }"),
    );

    cfLoom(project, 'generate');

    expect(read(project, 'src/generated/readers.generated.ts')).toContain(
      "from '../contract/messages.ts';",
    );
  });

  test('generate says each file it wrote, at its configured path', () => {
    const project = aProject(withLayout(aService(), movedLayout));

    const ran = cfLoom(project, 'generate');

    expect(ran.stdout).toBe(
      lines([
        'Wrote contract.snapshot.json',
        'Wrote src/generated/handlers.generated.ts',
        'Wrote src/generated/readers.generated.ts',
        'Wrote src/http/orders/create-order.handler.ts',
        'Wrote src/http/orders/get-order.handler.ts',
        'Wrote src/security/api-key.handler.ts',
      ]),
    );
  });

  test('the Snapshot is the same with and without a layout', () => {
    const plain = aProject(aMessagingService());
    const laidOut = aProject(withLayout(aMessagingService(), movedLayout));

    cfLoom(plain, 'generate');
    cfLoom(laidOut, 'generate');

    expect(read(laidOut, 'contract.snapshot.json')).toBe(read(plain, 'contract.snapshot.json'));
  });

  test('the Contract Package is the same with and without a layout', () => {
    const plain = aProject(aMessagingService());
    const laidOut = aProject(withLayout(aMessagingService(), movedLayout));
    cfLoom(plain, 'generate');
    cfLoom(laidOut, 'generate');

    cfLoom(plain, 'package');
    cfLoom(laidOut, 'package');

    expect(treeOf(laidOut, '.cf-loom/contract-package')).toEqual(
      treeOf(plain, '.cf-loom/contract-package'),
    );
  });

  test('two Command Versions at one path exit 3 naming both, and write nothing', () => {
    const project = aProject(
      withLayout(aMessagingService(), "{ command: 'src/commands/{name}.handler.ts' }"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'commands.ChargeCard@1 and commands.ChargeCard@2 are both src/commands/charge-card.handler.ts: give each its own path in the layout of cf-loom.config.ts\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
    expect(handlerFiles(project)).toEqual([]);
  });

  test('an Endpoint and a Guard at one path exit 3 naming both', () => {
    const project = aProject(
      withLayout(
        withEndpointNamedLikeGuard(),
        `{
          endpoint: 'src/handlers/{name}.handler.ts',
          guard: 'src/handlers/{name}.handler.ts',
        }`,
      ),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'endpoints.apiKey and guards.apiKey are both src/handlers/api-key.handler.ts: give each its own path in the layout of cf-loom.config.ts\n',
    });
  });

  test('a Retired Command’s Message Version still declared collides with a live one at its path', () => {
    const service = aMessagingService();
    const project = aProject(
      withLayout(
        {
          ...service,
          'src/contract/messages.ts': (service['src/contract/messages.ts'] ?? '').replace(
            "  description: 'Charge a card',\n  lifecycle: 'deprecated',",
            "  description: 'Charge a card',\n  lifecycle: 'retired',",
          ),
        },
        "{ command: 'src/commands/{name}.handler.ts' }",
      ),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'commands.ChargeCard@1 and commands.ChargeCard@2 are both src/commands/charge-card.handler.ts: give each its own path in the layout of cf-loom.config.ts\n',
    });
  });

  test('after layout.endpoint changes, the Handlers left at the old paths are orphans', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    write(project, withLayout({}, "{ endpoint: 'src/http/{group}/{name}.handler.ts' }"));

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: lines([
        orphanLine('src/endpoints/orders/create-order.handler.ts'),
        orphanLine('src/endpoints/orders/get-order.handler.ts'),
      ]),
    });
  });

  test('a Handler file anywhere under src/ that nothing declared names is an orphan', () => {
    const project = aProject({
      ...aService(),
      'src/http/error.handler.ts': "export default 'x';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: `${orphanLine('src/http/error.handler.ts')}\n`,
    });
  });

  test('a Handler file under src/contract/ is no Handler', () => {
    const project = aProject({
      ...aService(),
      'src/contract/support/error.handler.ts': "export default 'x';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
  });

  test.skipIf(isRoot)(
    'generate fails on an unreadable folder anywhere under src/ (skipped as root)',
    () => {
      const project = aProject({ ...aService(), 'src/support/kept.txt': '' });
      chmodSync(join(project, 'src/support'), 0o000);

      const ran = cfLoom(project, 'generate');

      chmodSync(join(project, 'src/support'), 0o755);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^src\/support cannot be read: EACCES[^\n]*\n$/);
    },
  );

  test.each([
    ['handlerMap', 'src/generated/handlers.generated.ts', 'src/handlers.generated.ts'],
    ['readers', 'src/generated/readers.generated.ts', 'src/readers.generated.ts'],
  ])('moving layout.%s to %s leaves the file at %s an orphan', (field, moved, old) => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    write(project, withLayout({}, `{ ${field}: '${moved}' }`));

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: `${old} is a file cf-loom generate wrote, at no path the layout names: delete it\n`,
    });
  });

  test.each([
    ['a CRLF line end', `${header}\r\nexport {};\r\n`],
    ['a byte order mark', `\uFEFF${header}\nexport {};\n`],
  ])(
    'a generated file an editor saved with %s, at no path the layout names, is an orphan',
    (_edit, text) => {
      const project = aProject({ ...aService(), 'src/old.generated.ts': text });

      const ran = cfLoom(project, 'generate');

      expect(ran).toEqual({
        status: 1,
        stdout: '',
        stderr:
          'src/old.generated.ts is a file cf-loom generate wrote, at no path the layout names: delete it\n',
      });
    },
  );

  test('a .generated.ts file that does not start with the generated header is no orphan', () => {
    const project = aProject({ ...aService(), 'src/schema.generated.ts': 'export {};\n' });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
  });

  test.skipIf(isRoot)(
    'a .generated.ts file that cannot be read is a tooling error (skipped as root)',
    () => {
      const project = aProject({ ...aService(), 'src/schema.generated.ts': 'export {};\n' });
      chmodSync(join(project, 'src/schema.generated.ts'), 0o000);

      const ran = cfLoom(project, 'generate');

      chmodSync(join(project, 'src/schema.generated.ts'), 0o644);
      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^src\/schema\.generated\.ts cannot be read: EACCES[^\n]*\n$/);
    },
  );
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
            "import { defineEndpoint } from '@cf-loom/contract';",
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
  test.each(['src/commands/capture-card.v1.handler.ts', 'src/subscriptions/old-audit.handler.ts'])(
    'a Handler file %s that nothing declared names exits 1 naming it',
    (path) => {
      const project = aProject({ ...aMessagingService(), [path]: "export default 'old';\n" });

      const ran = cfLoom(project, 'generate');

      expect(ran).toEqual({
        status: 1,
        stdout: '',
        stderr: `${path} names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it\n`,
      });
    },
  );

  test('the Handler of a Retired Command’s Message Version that is still declared is no orphan', () => {
    const project = aProject({
      ...aMessagingService(),
      'src/commands/refund-card.v1.handler.ts': "export default 'retired';\n",
    });

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
    expect(read(project, 'src/handlers.generated.ts')).not.toContain('refundCard');
  });

  test.each([
    ['charge-on-created', 'camelCase'],
    ['1stAudit', 'camelCase'],
    ['delete', 'camelCase and no reserved word'],
    ['handle', 'camelCase and no reserved word'],
  ])('a Subscription named %s, which is no name in code, fails the name grammar', (name, rule) => {
    const project = aProject(
      aMessagingService({ subscriptions: ['notifyOnSettled', inlineSubscription(name)] }),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: `subscriptions.${name}.name name-grammar: A Subscription name is ${rule}: ${name}\n`,
    });
  });

  test('a Command’s Message Version exported by no file exits 1 naming it, and writes nothing', () => {
    const project = aProject(aMessagingService());
    edit(project, 'src/contract/messages.ts', (text) =>
      text
        .replace('export const chargeCardV2 =', 'const chargeCardV2 =')
        .concat('export const commandList = [chargeCardV2];\n'),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text
        .replace('  chargeCardV2,\n', '  commandList,\n')
        .replace('[chargeCardV1, chargeCardV2,', '[chargeCardV1, commandList[0],'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'commands.ChargeCard@2 is exported by no file under src/contract/\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
    expect(existsSync(join(project, 'src/readers.generated.ts'))).toBe(false);
  });

  test('a Subscription exported by no file exits 1 naming it, and writes nothing', () => {
    const project = aProject(
      aMessagingService({ subscriptions: ['notifyOnSettled', inlineSubscription('auditOrders')] }),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'subscriptions.auditOrders is exported by no file under src/contract/\n',
    });
    expect(existsSync(join(project, 'contract.snapshot.json'))).toBe(false);
    expect(existsSync(join(project, 'src/readers.generated.ts'))).toBe(false);
  });

  test('a Command’s Message Version exported only under another name exits 1 naming it', () => {
    const project = aProject(aMessagingService());
    edit(project, 'src/contract/messages.ts', (text) =>
      text
        .replace('export const chargeCardV2 =', 'const chargeCardV2 =')
        .concat('export { chargeCardV2 as chargeCardNext };\n'),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace('  chargeCardV2,\n', '  chargeCardNext as chargeCardV2,\n'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'commands.ChargeCard@2 is not exported as chargeCardV2\n',
    });
  });

  test('a Subscription exported only under another name exits 1 naming it', () => {
    const project = aProject(aMessagingService());
    edit(project, 'src/contract/subscriptions.ts', (text) =>
      text.replace('export const auditCreated =', 'export const auditCreatedNext ='),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace('import { auditCreated,', 'import { auditCreatedNext as auditCreated,'),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'subscriptions.auditCreated is not exported as auditCreated\n',
    });
  });

  test('every Endpoint, Command and Subscription not exported under its name is named, the Endpoints first', () => {
    const service = aMessagingService({
      subscriptions: ['notifyOnSettled', inlineSubscription('auditOrders')],
    });
    const project = aProject({
      ...service,
      'src/contract/endpoints/orders/create-order.endpoint.ts': (
        service['src/contract/endpoints/orders/create-order.endpoint.ts'] ?? ''
      ).replace('export const createOrder =', 'export const createOrderEndpoint ='),
      'src/contract/messages.ts': (service['src/contract/messages.ts'] ?? '').replace(
        'export const refundCardV1 =',
        'export const refundCard =',
      ),
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '')
        .replace('import { createOrder }', 'import { createOrderEndpoint as createOrder }')
        .replace('  refundCardV1,\n', '  refundCard as refundCardV1,\n'),
    });

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: lines([
        'endpoints.createOrder is not exported as createOrder',
        'commands.RefundCard@1 is not exported as refundCardV1',
        'subscriptions.auditOrders is exported by no file under src/contract/',
      ]),
    });
  });

  test('a recursion id an own Message reaches that is no name in code exits 3 in one line', () => {
    const project = aProject(aMessagingService());
    edit(project, 'src/contract/messages.ts', (text) =>
      text.replace(".meta({ id: 'tree' })", ".meta({ id: '2-tree' })"),
    );

    const ran = cfLoom(project, 'generate');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'The recursion id 2-tree is no name in code: rename it\n',
    });
  });

  test.each(['generate', 'verify'])(
    'a recursion id that is no name in code exits 3 of %s before a Subscription exported by no file exits 1',
    (command) => {
      const project = aProject(
        aMessagingService({
          subscriptions: ['notifyOnSettled', inlineSubscription('auditOrders')],
        }),
      );
      edit(project, 'src/contract/messages.ts', (text) =>
        text.replace(".meta({ id: 'tree' })", ".meta({ id: '2-tree' })"),
      );

      const ran = cfLoom(project, command);

      expect(ran).toEqual({
        status: 3,
        stdout: '',
        stderr: 'The recursion id 2-tree is no name in code: rename it\n',
      });
    },
  );
});

describe('cf-loom generate: roots that offer no Elements', () => {
  test.each([
    [
      'an Application',
      {
        'src/contract/index.ts': lines([
          "import { defineApplication } from '@cf-loom/contract';",
          "export const application = defineApplication({ name: 'orders-service', dependencies: [] });",
        ]),
      },
    ],
    [
      'a Definitions Package',
      {
        'src/definitions/index.ts': lines([
          "import { defineDefinitions } from '@cf-loom/contract';",
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

  test('a Service without Messages generates a Handler map that is a HandlerMap, with empty readers', () => {
    const project = aProject({ ...aService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    write(project, {
      'src/check.ts': lines([
        "import type { HandlerMap } from '@cf-loom/handlers';",
        importOf('handlers', './handlers.generated.ts'),
        '',
        'handlers satisfies HandlerMap;',
        'export const readers: { commands: Record<never, never>; subscriptions: Record<never, never> } = handlers.readers;',
      ]),
    });

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test('a Service generated with a layout passes tsc: the map, the readers and the stubs are all relocated', () => {
    const project = aProject({
      ...withLayout(aMessagingService(), movedLayout),
      'tsconfig.json': tsconfig,
    });
    expect(cfLoom(project, 'generate').status).toBe(0);

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  /** A file that type-checks the Handler map and the Message Handlers, with the lines given after. */
  function aCheck(after: readonly string[]): string {
    return lines([
      "import type { CommandHandler, EventHandler, HandlerMap } from '@cf-loom/handlers';",
      importOf('handlers', './handlers.generated.ts'),
      importOf('{ readers }', './readers.generated.ts'),
      '',
      'const { auditCreated } = readers.subscriptions;',
      'const { chargeCardV1, chargeCardV2 } = readers.commands;',
      'handlers satisfies HandlerMap;',
      ...after,
    ]);
  }

  test('the generated Service with Messages passes tsc: each stub is a CommandHandler or EventHandler and the map is a HandlerMap', () => {
    const project = aProject({ ...aMessagingService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    write(project, {
      'src/check.ts': aCheck([
        'export const charge: CommandHandler<typeof chargeCardV2> = handlers.commands.chargeCardV2;',
        'export const audit: EventHandler<typeof auditCreated> = handlers.subscriptions.auditCreated;',
        'export const old: CommandHandler<typeof chargeCardV1> = handlers.commands.chargeCardV1;',
      ]),
    });

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test('a Command’s Handler in another Message Version’s place is a type error', () => {
    const project = aProject({ ...aMessagingService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    write(project, {
      'src/check.ts': aCheck([
        '// @ts-expect-error ChargeCard@2’s Handler is no Handler of ChargeCard@1',
        'export const wrong: CommandHandler<typeof chargeCardV1> = handlers.commands.chargeCardV2;',
        'export { auditCreated, chargeCardV2 };',
      ]),
    });

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test('an implemented Handler’s body is typed by its Reader: an Unknown case type-checks and a bare undeclared value does not', () => {
    const project = aProject({ ...aMessagingService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    write(project, {
      'src/subscriptions/audit-created.handler.ts': lines([
        "import { handle } from '@cf-loom/handlers';",
        importOf('{ readers }', '../readers.generated.ts'),
        '',
        'export default handle(readers.subscriptions.auditCreated, async (body) => {',
        "  const status: 'pending' | 'paid' | { unknown: string } = body.status;",
        '  console.log(status);',
        '  return undefined;',
        '});',
      ]),
      'src/check.ts': aCheck([
        "const meta = { messageId: 'm-1', factId: 'f-1', deliveryCount: 1 };",
        "const items = { label: 'root', children: [] };",
        "const orderId = '0b8f5f8e-8a5e-4c1e-9d0c-2f3b8c1d2e3f';",
        'const audit = handlers.subscriptions.auditCreated;',
        "export const unknown = audit({ orderId, status: { unknown: 'refunded' }, items }, meta);",
        '// @ts-expect-error an undeclared value is read as its Unknown case, never bare',
        "export const bare = audit({ orderId, status: 'refunded', items }, meta);",
        'export { auditCreated, chargeCardV1, chargeCardV2 };',
      ]),
    });

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test.each([
    'src/commands/charge-card.v2.handler.ts',
    'src/subscriptions/audit-created.handler.ts',
  ])('a deleted Message Handler file %s is a type error', (path) => {
    const project = aProject({ ...aMessagingService(), 'tsconfig.json': tsconfig });
    expect(cfLoom(project, 'generate').status).toBe(0);
    rmSync(join(project, path));

    const checked = typeCheck(project);

    expect(checked.status).not.toBe(0);
    expect(checked.stdout).toContain('error TS2307');
    expect(checked.stdout).toContain(path.replace('src/', './'));
  });

  test('a root whose subscriptions are held in a variable generates a Service that passes tsc with noUncheckedIndexedAccess', () => {
    const service = aMessagingService();
    const project = aProject({
      ...service,
      'src/contract/index.ts': (service['src/contract/index.ts'] ?? '')
        .replace(
          'export const contract',
          'const listed = [notifyOnSettled, auditCreated];\n\nexport const contract',
        )
        .replace('subscriptions: [notifyOnSettled, auditCreated],', 'subscriptions: listed,'),
      'tsconfig.json': tsconfig.replace(
        '"strict":true',
        '"strict":true,"noUncheckedIndexedAccess":true',
      ),
    });
    expect(cfLoom(project, 'generate').status).toBe(0);

    const checked = typeCheck(project);

    expect(checked).toEqual({ status: 0, stdout: '' });
  });

  test.each(['chargeCardV1', 'readersOf', 'z', 'readers', 'orderCreatedV2Reader', 'treeReaderDef'])(
    'a Subscription named %s generates a Service that passes tsc',
    (name) => {
      const service = aMessagingService({
        subscriptions: ['notifyOnSettled', 'auditCreated', `${name}Subscription`],
      });
      const project = aProject({
        ...service,
        'src/contract/subscriptions.ts': `${subscriptions}\nexport const ${name} = defineSubscription({ name: '${name}', description: 'Name', event: orderCreatedV2 });\n`,
        'src/contract/index.ts': (service['src/contract/index.ts'] ?? '').replace(
          "import { auditCreated, notifyOnSettled } from './subscriptions.ts';",
          lines([
            'import {',
            '  auditCreated,',
            `  ${name} as ${name}Subscription,`,
            '  notifyOnSettled,',
            "} from './subscriptions.ts';",
          ]).trimEnd(),
        ),
        'tsconfig.json': tsconfig,
      });

      const ran = cfLoom(project, 'generate');

      expect(ran.status).toBe(0);
      expect(typeCheck(project)).toEqual({ status: 0, stdout: '' });
    },
  );
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

  test('verify writes nothing', () => {
    const project = aProject(aService());

    cfLoom(project, 'verify');

    expect(existsSync(join(project, 'src/handlers.generated.ts'))).toBe(false);
    expect(existsSync(join(project, 'src/readers.generated.ts'))).toBe(false);
    expect(handlerFiles(project)).toEqual([]);
  });
  test('verify exits 0 with Messages when every generated file is up to date', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');

    const ran = cfLoom(project, 'verify');

    expect(ran).toMatchObject({ status: 0, stderr: '' });
  });

  test('verify exits 1 when a Retired Command’s Message Version was added since generate: its Reader and pairing are new', () => {
    const project = aProject(aMessagingService({ commands: '[chargeCardV1, chargeCardV2]' }));
    cfLoom(project, 'generate');
    write(project, { 'src/contract/index.ts': aMessagingRoot() });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: lines([
        'contract.snapshot.json was edited or is out of date: run cf-loom generate',
        'src/readers.generated.ts was edited or is out of date: run cf-loom generate',
      ]),
    });
  });

  test('verify exits 1 when a Command whose Handler the map imports was added since generate', () => {
    const project = aProject(aMessagingService({ commands: '[chargeCardV1, refundCardV1]' }));
    cfLoom(project, 'generate');
    write(project, { 'src/contract/index.ts': aMessagingRoot() });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: lines([
        'contract.snapshot.json was edited or is out of date: run cf-loom generate',
        'src/handlers.generated.ts was edited or is out of date: run cf-loom generate',
        'src/readers.generated.ts was edited or is out of date: run cf-loom generate',
        'src/commands/charge-card.v2.handler.ts is missing: run cf-loom generate',
      ]),
    });
  });

  test('verify exits 0 when the root’s commands are reordered, since readers.generated.ts imports them by export', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    write(project, {
      'src/contract/index.ts': aMessagingRoot({
        commands: '[chargeCardV2, chargeCardV1, refundCardV1]',
      }),
    });

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(0);
  });

  test('verify exits 1 on a Subscription exported by no file', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    write(project, {
      'src/contract/index.ts': aMessagingRoot({
        subscriptions: ['notifyOnSettled', 'auditCreated', inlineSubscription('auditOrders')],
      }),
    });

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(
      'subscriptions.auditOrders is exported by no file under src/contract/\n',
    );
  });

  test('verify exits 1 on an Endpoint exported only under another name, as generate does', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    edit(project, 'src/contract/endpoints/orders/create-order.endpoint.ts', (text) =>
      text.replace('export const createOrder =', 'export const createOrderEndpoint ='),
    );
    edit(project, 'src/contract/index.ts', (text) =>
      text.replace('import { createOrder }', 'import { createOrderEndpoint as createOrder }'),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'endpoints.createOrder is not exported as createOrder\n',
    });
  });

  test('verify exits 1 naming the readers file out of date after a Command’s Message Version is exported from another file', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    edit(project, 'src/contract/messages.ts', (text) =>
      text.slice(0, text.indexOf('export const refundCardV1 =')),
    );
    write(project, {
      'src/contract/refunds.ts': lines([
        "import { defineCommand } from '@cf-loom/contract';",
        "import { z } from 'zod';",
        '',
        'export const refundCardV1 = defineCommand({',
        "  name: 'RefundCard',",
        '  version: 1,',
        "  description: 'Refund a card',",
        "  lifecycle: 'retired',",
        '  body: z.object({ orderId: z.uuid() }),',
        '});',
      ]),
    });
    edit(project, 'src/contract/index.ts', (text) =>
      text
        .replace('  refundCardV1,\n', '')
        .replace(
          'import { paymentSettledV1,',
          "import { refundCardV1 } from './refunds.ts';\nimport { paymentSettledV1,",
        ),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/readers.generated.ts was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 3 on a recursion id an own Message reaches that is no name in code', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    edit(project, 'src/contract/messages.ts', (text) =>
      text.replace(".meta({ id: 'tree' })", ".meta({ id: '2-tree' })"),
    );

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: 'The recursion id 2-tree is no name in code: rename it\n',
    });
  });

  test('verify exits 1 on a Handler file under src/subscriptions no declared Subscription names', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    write(project, { 'src/subscriptions/old-audit.handler.ts': "export default 'old';\n" });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        "src/subscriptions/old-audit.handler.ts names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it\n",
    });
  });
});

describe('cf-loom verify: a configured layout', () => {
  test('verify exits 0 on a Service generated with a layout', () => {
    const project = aProject(withLayout(aMessagingService(), movedLayout));
    cfLoom(project, 'generate');

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 0,
      stdout: lines([
        'contract.snapshot.json is up to date',
        'src/generated/handlers.generated.ts is up to date',
        'src/generated/readers.generated.ts is up to date',
      ]),
      stderr: '',
    });
  });

  test('verify exits 1 naming the configured Handler map when it was edited', () => {
    const project = aProject(withLayout(aService(), movedLayout));
    cfLoom(project, 'generate');
    write(project, {
      'src/generated/handlers.generated.ts': `${read(project, 'src/generated/handlers.generated.ts')}// mine\n`,
    });

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'src/generated/handlers.generated.ts was edited or is out of date: run cf-loom generate\n',
    });
  });

  test('verify exits 1 naming a configured Handler path that is missing', () => {
    const project = aProject(withLayout(aService(), movedLayout));
    cfLoom(project, 'generate');
    rmSync(join(project, 'src/http/orders/get-order.handler.ts'));

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: 'src/http/orders/get-order.handler.ts is missing: run cf-loom generate\n',
    });
  });

  test('verify exits 3 on two Elements at one Handler path', () => {
    const project = aProject(aMessagingService());
    cfLoom(project, 'generate');
    write(project, withLayout({}, "{ command: 'src/commands/{name}.handler.ts' }"));

    const ran = cfLoom(project, 'verify');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        'commands.ChargeCard@1 and commands.ChargeCard@2 are both src/commands/charge-card.handler.ts: give each its own path in the layout of cf-loom.config.ts\n',
    });
  });

  test('after layout.endpoint changes, verify exits 1 naming the Handlers left at the old paths', () => {
    const project = aProject(aService());
    cfLoom(project, 'generate');
    write(project, withLayout({}, "{ endpoint: 'src/http/{group}/{name}.handler.ts' }"));

    const ran = cfLoom(project, 'verify');

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(`${orphanLine('src/endpoints/orders/create-order.handler.ts')}\n`);
    expect(ran.stderr).toContain(`${orphanLine('src/endpoints/orders/get-order.handler.ts')}\n`);
  });

  test.each([
    ['handlerMap', 'src/generated/handlers.generated.ts', 'src/handlers.generated.ts'],
    ['readers', 'src/generated/readers.generated.ts', 'src/readers.generated.ts'],
  ])(
    'after layout.%s moves to %s, verify exits 1 naming the file left at %s',
    (field, moved, old) => {
      const project = aProject(aService());
      cfLoom(project, 'generate');
      write(project, withLayout({}, `{ ${field}: '${moved}' }`));

      const ran = cfLoom(project, 'verify');

      expect(ran.status).toBe(1);
      expect(ran.stderr).toContain(
        `${old} is a file cf-loom generate wrote, at no path the layout names: delete it\n`,
      );
    },
  );
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

  test('a Handler file reached through a link into src/contract/ is no orphan', () => {
    const project = aProject({
      ...aService(),
      'src/contract/support/stray.handler.ts': "export default 'x';\n",
    });
    symlinkSync(join(project, 'src/contract'), join(project, 'src/link'), 'dir');

    const ran = cfLoom(project, 'generate');

    expect(ran.status).toBe(0);
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

  test.each(['generate', 'verify'])(
    'a file under src/contract the root does not import that cannot be loaded is a tooling error of %s',
    (command) => {
      const project = aProject({ ...aService(), 'src/contract/broken.ts': 'export const = ;\n' });

      const ran = cfLoom(project, command);

      expect(ran.status).toBe(3);
      expect(ran.stderr).toMatch(/^src\/contract\/broken\.ts cannot be loaded: [^\n]+\n$/);
    },
  );

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
    'an unreadable folder under src/ is a tooling error in one line (skipped as root)',
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

  test.skipIf(isRoot).each(['generate', 'verify'])(
    'an unreadable folder under src/contract is a tooling error of %s in one line (skipped as root)',
    (command) => {
      const project = aProject({ ...aService(), 'src/contract/locked/kept.txt': '' });
      chmodSync(join(project, 'src/contract/locked'), 0o000);

      const ran = cfLoom(project, command);

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
