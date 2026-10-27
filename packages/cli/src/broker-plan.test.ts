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
import { afterEach, describe, expect, test } from 'vitest';
import { bin } from '../test/cf-loom-run.ts';
import { aDeadAddress } from '../test/dead-address.ts';
import { installedPayments, paymentsSpecifier } from '../test/payments-package.ts';
import { usage } from '../test/usage.ts';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

/** A project in a temporary directory, with cf-loom, its handlers and zod installed. */
function aProject(files: Readonly<Record<string, string>>): string {
  const project = mkdtempSync(join(tmpdir(), 'cf-loom-broker-plan-'));
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

/** The project after `generate` wrote its Snapshot, which `broker-plan` reads. */
function aGeneratedProject(files: Readonly<Record<string, string>>): string {
  const project = aProject(files);
  const generated = cfLoom(project, 'generate');
  if (generated.status !== 0) {
    throw new Error(`generate failed: ${generated.stderr}`);
  }
  return project;
}

/** What a command printed on stdout, one entry per line. */
function printedLines(stdout: string): readonly string[] {
  return stdout.trimEnd().split('\n');
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
  'export const config = defineConfig({});',
]);

const messages = lines([
  "import { defineCommand, defineEvent } from '@cf-loom/contract';",
  "import { z } from 'zod';",
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
  '  body: z.object({ orderId: z.uuid() }),',
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

const notifyOnSettled = 'notifyOnSettled';

const auditCreated = 'auditCreated';

/** The Subscriptions among `listed`, each exported under its name, with the imports they need. */
function subscriptionsFile(listed: readonly string[]): string {
  const subscriptions: Readonly<Record<string, readonly string[]>> = {
    [notifyOnSettled]: [
      importOf('{ paymentSettledV1 }', paymentsSpecifier),
      '',
      'export const notifyOnSettled = defineSubscription({',
      "  name: 'notifyOnSettled',",
      "  description: 'Notify on settled',",
      '  event: paymentSettledV1,',
      '});',
    ],
    [auditCreated]: [
      importOf('{ orderCreatedV2 }', './messages.ts'),
      '',
      'export const auditCreated = defineSubscription({',
      "  name: 'auditCreated',",
      "  description: 'Audit created',",
      '  event: orderCreatedV2,',
      '});',
    ],
  };
  return lines([
    "import { defineSubscription } from '@cf-loom/contract';",
    ...listed.flatMap((name) => subscriptions[name] ?? []),
  ]);
}

/** The names a Root lists in one field, from the text of its list. */
function namesListed(list: string): readonly string[] {
  return list
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** The file of `messages` without the declarations that no list names, so each one it exports is listed. */
function messagesFile(listed: readonly string[]): string {
  const blocks = messages.trimEnd().split('\n\n');
  const kept = blocks.filter((block) => {
    const name = /^export const (\w+) =/.exec(block)?.[1];
    return name === undefined || listed.includes(name);
  });
  return lines([kept.join('\n\n')]);
}

/** What a messaging Root's Group lists, each as the text of one of `defineGroup`'s fields; an empty one is left out. */
type MessagingLists = {
  readonly events?: string;
  readonly commands?: string;
  readonly subscriptions?: readonly string[];
};

/**
 * A Service named `orders-service` with the Events `OrderCreated@1` (Deprecated), `OrderCreated@2`
 * and `OrderPurged@1` (Retired), the Commands `ChargeCard@1` (Deprecated), `ChargeCard@2` and
 * `RefundCard@1` (Retired), and the Subscriptions `notifyOnSettled`, to the Event `PaymentSettled@1`
 * of the Dependency `payments-service`, and `auditCreated`, to its own `OrderCreated@2`; a list
 * that names fewer leaves the others out of the files, since a file exports only what is listed.
 */
function aMessagingService({
  events = '[orderCreatedV1, orderCreatedV2, orderPurgedV1]',
  commands = '[chargeCardV1, chargeCardV2, refundCardV1]',
  subscriptions: listed = [notifyOnSettled, auditCreated],
}: MessagingLists = {}): Readonly<Record<string, string>> {
  const messageNames = [...namesListed(events), ...namesListed(commands)];
  const grouped = [
    ['events', events],
    ['commands', commands],
    ['subscriptions', `[${listed.join(', ')}]`],
  ]
    .filter(([, list]) => list !== '[]')
    .map(([field, list]) => `  ${field}: ${list},`);
  const root = lines([
    "import { defineService, defineDependency, defineGroup } from '@cf-loom/contract';",
    ...(messageNames.length > 0
      ? [importOf(`{ ${[...messageNames].sort().join(', ')} }`, './messages.ts')]
      : []),
    importOf(`{ ${[...listed].sort().join(', ')} }`, './subscriptions.ts'),
    '',
    'const orders = defineGroup({',
    "  name: 'orders',",
    "  description: 'Orders',",
    ...grouped,
    '});',
    '',
    'export const contract = defineService({',
    "  name: 'orders-service',",
    '  groups: [orders],',
    '});',
  ]);
  return {
    'package.json': manifest,
    'cf-loom.config.ts': config,
    'src/contract/messages.ts': messagesFile(messageNames),
    ...installedPayments(),
    'src/contract/subscriptions.ts': subscriptionsFile(listed),
    'src/contract/index.ts': root,
  };
}

/** A Service with the Messages of the messaging README's example of the broker plan. */
function theReadmeService(): Readonly<Record<string, string>> {
  return aMessagingService({ commands: '[chargeCardV1]', subscriptions: [notifyOnSettled] });
}

/** A Service named `orders-service` that declares no Message. */
function aServiceWithoutMessages(): Readonly<Record<string, string>> {
  return {
    'package.json': manifest,
    'cf-loom.config.ts': config,
    'src/contract/index.ts': lines([
      "import { defineService } from '@cf-loom/contract';",
      '',
      "export const contract = defineService({ name: 'orders-service' });",
    ]),
  };
}

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
    'export const definitions = defineDefinitions({});',
  ]),
};

const staleSnapshotLine = 'contract.snapshot.json is missing or out of date: run cf-loom generate';

/** The document `broker-plan --json` prints for the Service of `theReadmeService`: the plan the messaging README shows, in the one document every command prints. */
function planDocument(): string {
  return JSON.stringify({ format: 1, status: 0, plan: readmePlan() });
}

/** The plan the messaging README shows for the Service of `theReadmeService`, as the README writes it. */
function readmePlan(): unknown {
  const readme = readFileSync(join(packagesDir, 'messaging/README.md'), 'utf8');
  const shown = /```json\n(\{\n {2}"prefix": null[\s\S]*?\n\})\n```/.exec(readme)?.[1];
  if (shown === undefined) {
    throw new Error('the messaging README shows no broker plan');
  }
  return JSON.parse(shown);
}

describe('cf-loom broker-plan', () => {
  test('broker-plan prints the Service’s stream with the subjects of its Event and Command Message Versions that are not Retired, in code point order, and exits 0', () => {
    const project = aGeneratedProject(aMessagingService());

    const ran = cfLoom(project, 'broker-plan');

    expect(ran.status).toBe(0);
    expect(ran.stderr).toBe('');
    expect(printedLines(ran.stdout)[0]).toBe(
      'Stream orders-service: orders-service.command.ChargeCard.v1 orders-service.command.ChargeCard.v2 orders-service.event.OrderCreated.v1 orders-service.event.OrderCreated.v2',
    );
  });

  test('a Retired Event or Command Version has no subject in the stream, and a Retired Command Version has no durable consumer', () => {
    const project = aGeneratedProject(aMessagingService());

    const ran = cfLoom(project, 'broker-plan');

    expect(ran.stdout).toContain('Stream orders-service:');
    expect(ran.stdout).not.toContain('OrderPurged');
    expect(ran.stdout).not.toContain('RefundCard');
  });

  test('a Deprecated Command Version keeps its subject and its durable consumer, <service>_command_<Name>_v<n>', () => {
    const project = aGeneratedProject(aMessagingService());

    const ran = cfLoom(project, 'broker-plan');

    expect(printedLines(ran.stdout)).toContain(
      'Durable consumer orders-service_command_ChargeCard_v1 on orders-service: orders-service.command.ChargeCard.v1',
    );
    expect(printedLines(ran.stdout)[0]).toContain(' orders-service.command.ChargeCard.v1 ');
  });

  test('a Subscription’s durable consumer, <service>_<name>, reads its Provider’s stream on its Event’s subject, and one to the Service’s own Event reads its own stream', () => {
    const project = aGeneratedProject(aMessagingService());

    const ran = cfLoom(project, 'broker-plan');

    expect(printedLines(ran.stdout)).toEqual(
      expect.arrayContaining([
        'Durable consumer orders-service_notify-on-settled on payments-service: payments-service.event.PaymentSettled.v1',
        'Durable consumer orders-service_audit-created on orders-service: orders-service.event.OrderCreated.v2',
      ]),
    );
  });

  test('a Service that publishes and sends nothing has no stream, only the durable consumers of its Subscriptions', () => {
    const project = aGeneratedProject(
      aMessagingService({ events: '[]', commands: '[]', subscriptions: [notifyOnSettled] }),
    );

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 0,
      stdout:
        'Durable consumer orders-service_notify-on-settled on payments-service: payments-service.event.PaymentSettled.v1\n',
      stderr: '',
    });
  });

  test('a Service with no Messages says it needs no stream and no durable consumer', () => {
    const project = aGeneratedProject(aServiceWithoutMessages());

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 0,
      stdout: 'orders-service needs no stream and no durable consumer\n',
      stderr: '',
    });
  });

  test('--json writes exactly one line, the plan the messaging README shows', () => {
    const project = aGeneratedProject(theReadmeService());

    const ran = cfLoom(project, 'broker-plan', '--json');

    expect(ran).toEqual({ status: 0, stdout: `${planDocument()}\n`, stderr: '' });
  });

  test('--prefix puts the prefix in front of every subject, stream and durable consumer name', () => {
    const project = aGeneratedProject(theReadmeService());

    const ran = cfLoom(project, 'broker-plan', '--prefix', 'staging');

    expect(ran).toEqual({
      status: 0,
      stdout: lines([
        'Stream staging_orders-service: staging.orders-service.command.ChargeCard.v1 staging.orders-service.event.OrderCreated.v1 staging.orders-service.event.OrderCreated.v2',
        'Durable consumer staging_orders-service_command_ChargeCard_v1 on staging_orders-service: staging.orders-service.command.ChargeCard.v1',
        'Durable consumer staging_orders-service_notify-on-settled on staging_payments-service: staging.payments-service.event.PaymentSettled.v1',
      ]),
      stderr: '',
    });
  });

  test('--json with --prefix carries the prefix, and service stays unprefixed', () => {
    const project = aGeneratedProject(theReadmeService());

    const ran = cfLoom(project, 'broker-plan', '--prefix', 'staging', '--json');

    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout).plan).toEqual({
      prefix: 'staging',
      streams: {
        'staging_orders-service': {
          service: 'orders-service',
          subjects: [
            'staging.orders-service.command.ChargeCard.v1',
            'staging.orders-service.event.OrderCreated.v1',
            'staging.orders-service.event.OrderCreated.v2',
          ],
        },
      },
      consumers: {
        'staging_orders-service_command_ChargeCard_v1': {
          service: 'orders-service',
          stream: 'staging_orders-service',
          subject: 'staging.orders-service.command.ChargeCard.v1',
        },
        'staging_orders-service_notify-on-settled': {
          service: 'orders-service',
          stream: 'staging_payments-service',
          subject: 'staging.payments-service.event.PaymentSettled.v1',
        },
      },
    });
  });

  test('broker-plan runs offline: with no npm on PATH and the registry at a dead address, it prints the plan', async () => {
    const project = aGeneratedProject(theReadmeService());

    const ran = await cfLoomOffline(project, 'broker-plan', '--json');

    expect(ran).toEqual({ status: 0, stdout: `${planDocument()}\n`, stderr: '' });
  });
});

describe('cf-loom broker-plan: what it refuses', () => {
  test('broker-plan fails when contract.snapshot.json is missing, exit 1, printing no plan', () => {
    const project = aProject(aMessagingService());

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('broker-plan fails when contract.snapshot.json is out of date, exit 1, printing no plan', () => {
    const project = aGeneratedProject(aMessagingService());
    write(project, aMessagingService({ commands: '[chargeCardV2]' }));

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({ status: 1, stdout: '', stderr: `${staleSnapshotLine}\n` });
  });

  test('a Root that breaks a rule fails broker-plan with generate’s lines', () => {
    const project = aProject({
      ...aMessagingService(),
      'package.json': JSON.stringify({ name: '@org/billing-service', type: 'module' }),
    });

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'src/contract/index.ts: (root) name package-name: A Root is named as its package.json, without the scope: "orders-service" is written, package.json names "billing-service"\n',
    });
  });

  test('a Dependency written as the types refuse fails with its line, never as a Root that threw', () => {
    const service = aMessagingService();
    const root = (service['src/contract/index.ts'] ?? '').replace(
      '  groups: [orders],',
      '  groups: [orders],\n  dependencies: [defineDependency({ endpoints: [undefined] } as never)],',
    );
    const project = aProject({ ...service, 'src/contract/index.ts': root });

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 1,
      stdout: '',
      stderr: '(root) dependencies[0].endpoints[0] not-a-declaration: is not an Endpoint\n',
    });
  });

  test('a contract.snapshot.json that is no JSON is a tooling error', () => {
    const project = aProject({
      ...aMessagingService(),
      'contract.snapshot.json': '<<<<<<< HEAD\n',
    });

    const ran = cfLoom(project, 'broker-plan');

    expect(ran.status).toBe(3);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(
      /^contract\.snapshot\.json is no JSON \([^\n]+\): run cf-loom generate\n$/,
    );
  });

  test('an Application has no broker plan, a tooling error', () => {
    const project = aProject(anApplication);

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        "An Application has no broker plan: only a Service's Messages travel through the Broker\n",
    });
  });

  test('a Definitions Package has no broker plan, a tooling error', () => {
    const project = aProject(aDefinitionsPackage);

    const ran = cfLoom(project, 'broker-plan');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr:
        "A Definitions Package has no broker plan: only a Service's Messages travel through the Broker\n",
    });
  });

  test.for([
    ['a missing Snapshot', aMessagingService(), 1, staleSnapshotLine],
    [
      'an Application',
      anApplication,
      3,
      "An Application has no broker plan: only a Service's Messages travel through the Broker",
    ],
  ] as const)(
    '--json gives the errors of %s, and stderr still carries their lines',
    ([_case, files, status, line]) => {
      const project = aProject(files);

      const ran = cfLoom(project, 'broker-plan', '--json');

      expect(ran).toEqual({
        status,
        stdout: `${JSON.stringify({ format: 1, status, errors: [line] })}\n`,
        stderr: `${line}\n`,
      });
    },
  );

  test.for([
    ['a prefix with an underscore', ['--prefix', 'stag_ing']],
    ['a prefix of 65 characters', ['--prefix', 'a'.repeat(65)]],
    ['no prefix after the option', ['--prefix']],
  ] as const)('a prefix that is not a Broker prefix is a usage error: %s', ([_case, options]) => {
    const project = aProject({});

    const ran = cfLoom(project, 'broker-plan', ...options);

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `--prefix takes a prefix in kebab-case of at most 64 characters, such as staging. ${usage}\n`,
    });
  });

  test('only broker-plan and asyncapi take --prefix', () => {
    const project = aProject({});

    const ran = cfLoom(project, 'generate', '--prefix', 'staging');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `Only broker-plan and asyncapi take --prefix. ${usage}\n`,
    });
  });

  test('broker-plan takes no argument', () => {
    const project = aProject({});

    const ran = cfLoom(project, 'broker-plan', 'now');

    expect(ran).toEqual({
      status: 3,
      stdout: '',
      stderr: `broker-plan takes no argument. ${usage}\n`,
    });
  });
});
