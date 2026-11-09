import {
  cpSync,
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
import { basename, dirname, join } from 'node:path';
import { test as baseTest, describe, expect } from 'vitest';
import { cfLoomWith, type Ran } from '../test/cf-loom-run.ts';
import { aRegistry, type Registry } from '../test/fake-registry.ts';
import { anNpmEnvironment, loginTo, type NpmEnvironment } from '../test/npm-environment.ts';
import type { Published as Put } from '../test/published-put.ts';
import { entriesOf } from '../test/tarball.ts';

const rootDir = join(import.meta.dirname, '..', '..', '..');
const examplesDir = join(rootDir, 'examples');

/** The examples in the order the organization publishes them: Definitions first, then the Services. */
const publishedExamples = [
  { example: 'org-definitions', packageName: '@org/definitions' },
  { example: 'orders-service', packageName: '@org/contract-orders-service' },
  { example: 'billing-service', packageName: '@org/contract-billing-service' },
] as const;

/** The registry the examples were published to, the npm environment that reaches it and how each publish ended. */
type Published = {
  readonly folder: string;
  readonly registry: Registry;
  readonly env: NpmEnvironment;
  readonly publishes: readonly Ran[];
};

/**
 * A copy of an example in `folder`, without its installed packages and Contract Package, with each
 * package linked in, except those the registry was put: they are installed from their tarballs,
 * each in a folder of its own, so nothing is ever written into the repository.
 */
function aCopyOf(example: string, folder: string, put: readonly Put[] = []): string {
  const source = join(examplesDir, example);
  const copy = mkdtempSync(join(folder, `${example}-`));
  const isLeftOut = (path: string) =>
    basename(path) === 'node_modules' || path === join(source, '.cf-loom');
  cpSync(source, copy, { recursive: true, filter: (path) => !isLeftOut(path) });
  const modules = join(source, 'node_modules');
  for (const entry of readdirSync(modules).filter((name) => name !== '.cache')) {
    const isScope = entry.startsWith('@');
    const names = isScope ? readdirSync(join(modules, entry)).map((n) => `${entry}/${n}`) : [entry];
    for (const name of names) {
      const published = put.find((candidate) => candidate.name === name);
      if (published === undefined) {
        link(join(modules, name), join(copy, 'node_modules', name));
      } else {
        installed(published, join(copy, 'node_modules', name));
      }
    }
  }
  link(join(rootDir, 'node_modules/typescript'), join(copy, 'node_modules/typescript'));
  return copy;
}

/** Unpacks the tarball a registry was put into a folder, as an install does. */
function installed(published: Put, folder: string): void {
  for (const [path, text] of Object.entries(entriesOf(published.tarball))) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(realpathSync(target), path, 'dir');
}

/** npm refuses to publish a package that is `private`, which the Definitions Package of the examples is. */
function withoutPrivate(copy: string): void {
  const manifestPath = join(copy, 'package.json');
  const { private: _private, ...manifest } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Throws when `before` is gone from the file, so an example that drifted fails the test plainly. */
function replacedIn(file: string, before: string, after: string): void {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(before)) {
    throw new Error(`${file} no longer holds: ${before}`);
  }
  writeFileSync(file, text.replace(before, after));
}

async function publishedExamplesIn(folder: string, registry: Registry): Promise<Published> {
  const userConfig = `registry=${registry.url}/\n${loginTo(registry)}`;
  const env = anNpmEnvironment(folder, { userConfig });
  const publishes: Ran[] = [];
  for (const { example } of publishedExamples) {
    const copy = aCopyOf(example, folder, registry.published);
    if (example === 'org-definitions') {
      withoutPrivate(copy);
    }
    const generated = await cfLoomWith(copy, env, 'generate');
    if (generated.status !== 0) {
      throw new Error(`generate failed in ${example}: ${generated.stderr}`);
    }
    publishes.push(await cfLoomWith(copy, env, 'publish'));
  }
  return { folder, registry, env, publishes };
}

/** Vitest's `test` with an `examples` fixture: the three examples published once to a registry of this file. */
const test = baseTest.extend<{ examples: Published }>({
  examples: [
    // biome-ignore lint/correctness/noEmptyPattern: vitest reads what a fixture needs from this pattern
    async ({}, use) => {
      const registry = await aRegistry();
      const folder = mkdtempSync(join(tmpdir(), 'cf-loom-examples-'));
      try {
        await use(await publishedExamplesIn(folder, registry));
      } finally {
        rmSync(folder, { recursive: true, force: true });
        await registry.close();
      }
    },
    { scope: 'file' },
  ],
});

describe('cf-loom publish and check on the examples', () => {
  test('org-definitions, orders-service and billing-service each publish 1.0.0, with no Approval source configured', ({
    examples,
  }) => {
    const { registry, publishes } = examples;

    const expectedPublishes = publishedExamples.map(({ packageName }) => ({
      status: 0,
      stdout: expect.stringContaining(`Published ${packageName}@1.0.0`),
      stderr: '',
    }));
    expect(publishes).toEqual(expectedPublishes);
    expect(publishes.map(({ stdout }) => stdout.includes('Peer '))).toEqual([false, false, false]);
    const published = registry.published.map(({ name, version }) => `${name}@${version}`);
    expect(published).toEqual(publishedExamples.map(({ packageName }) => `${packageName}@1.0.0`));
  });

  test('billing-service is published against the versions of the packages it installed from the registry', ({
    examples,
  }) => {
    const { registry } = examples;
    const billing = registry.published.find(({ name }) => name === '@org/contract-billing-service');

    const published = JSON.parse(entriesOf(billing!.tarball)['snapshot.json'] ?? '{}');

    expect(published.dependencies['orders-service'].against).toBe('1.0.0');
    const origins = Object.values<{ origin: string }>(published.codes).map(({ origin }) => origin);
    expect(origins).toContain('@org/definitions@1.0.0');
    expect(JSON.stringify(published)).not.toContain('@org/definitions@0.0.0');
  });

  test('billing-service as the workspace holds it, against 0.0.0, is refused by publish and reported by check', async ({
    examples,
  }) => {
    const { folder, env, registry } = examples;
    const billing = aCopyOf('billing-service', folder);
    const puts = registry.published.length;
    const unlisted = [
      'dependencies.orders-service is against @org/contract-orders-service@0.0.0, which the registry does not list: install a published version',
      '@org/definitions@0.0.0, which the Contract uses, is not listed by the registry: install a published version',
      '',
    ].join('\n');

    const checked = await cfLoomWith(billing, env, 'check');
    const published = await cfLoomWith(billing, env, 'publish');

    expect(checked.stderr).toBe(unlisted);
    expect(published).toMatchObject({ status: 3, stderr: unlisted });
    expect(registry.published).toHaveLength(puts);
  });

  test('renaming org-definitions’ money export to amount is Breaking, and check exits 2', async ({
    examples,
  }) => {
    const { folder, env, registry } = examples;
    const definitions = aCopyOf('org-definitions', folder, registry.published);
    const index = join(definitions, 'src/definitions/index.ts');
    replacedIn(
      index,
      'export { apiKey, money, unauthenticated };',
      'export { apiKey, money as amount, unauthenticated };',
    );
    const generated = await cfLoomWith(definitions, env, 'generate');
    expect(generated).toMatchObject({ status: 0, stderr: '' });

    const checked = await cfLoomWith(definitions, env, 'check');

    expect(checked).toEqual({
      status: 2,
      stdout: [
        'Checked against @org/definitions@1.0.0',
        'exports.amount added: Additive',
        'exports.money removed: Breaking, needs a Breaking Change Approval',
        'Would publish @org/definitions@2.0.0 (major)',
        '',
      ].join('\n'),
      stderr:
        '1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it\n',
    });
  });

  test('billing with a Subscription described otherwise reports it as Neutral and would publish a patch, exit 0', async ({
    examples,
  }) => {
    const { folder, env, registry } = examples;
    const billing = aCopyOf('billing-service', folder, registry.published);
    const subscription = join(
      billing,
      'src/contract/subscriptions/billing/draft-invoice-on-created.subscription.ts',
    );
    replacedIn(subscription, 'Drafts an invoice for each order created', 'Drafts each invoice');
    const generated = await cfLoomWith(billing, env, 'generate');
    expect(generated).toMatchObject({ status: 0, stderr: '' });

    const checked = await cfLoomWith(billing, env, 'check');

    expect(checked).toEqual({
      status: 0,
      stdout: [
        'Checked against @org/contract-billing-service@1.0.0',
        'subscriptions.draftInvoiceOnCreated description-changed: Neutral',
        'No Change needs a Breaking Change Approval',
        'Would publish @org/contract-billing-service@1.0.1 (patch)',
        '',
      ].join('\n'),
      stderr: '',
    });
  });

  test('billing without standardRejections writes cf-loom’s standard codes, and check reports the change', async ({
    examples,
  }) => {
    const { folder, env, registry } = examples;
    const billing = aCopyOf('billing-service', folder, registry.published);
    const root = join(billing, 'src/contract/index.ts');
    replacedIn(root, '  standardRejections: orgDefinitions,\n', '');
    const generated = await cfLoomWith(billing, env, 'generate');
    expect(generated).toMatchObject({ status: 0, stderr: '' });
    const snapshot = JSON.parse(readFileSync(join(billing, 'contract.snapshot.json'), 'utf8'));

    const checked = await cfLoomWith(billing, env, 'check');

    expect(snapshot.standardRejections.notFound).toBe('NOT_FOUND');
    expect(snapshot.codes.NOT_FOUND.origin).toBe('standard');
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain(
      'endpoints.POST /invoices (createInvoice) rejection-added code=NOT_FOUND: Additive',
    );
    expect(checked.stdout).toContain(
      'endpoints.POST /invoices (createInvoice) rejection-removed code=RESOURCE_NOT_FOUND: Additive',
    );
  });

  test('removing a Success field from GET /orders/:orderId needs a Breaking Change Approval, and check exits 2', async ({
    examples,
  }) => {
    const { folder, env, registry } = examples;
    const orders = aCopyOf('orders-service', folder, registry.published);
    const getOrder = join(orders, 'src/contract/endpoints/orders/get-order.endpoint.ts');
    replacedIn(getOrder, 'body: order }', 'body: order.omit({ placedAt: true }) }');
    const generated = await cfLoomWith(orders, env, 'generate');
    expect(generated).toMatchObject({ status: 0, stderr: '' });

    const checked = await cfLoomWith(orders, env, 'check');

    expect(checked).toEqual({
      status: 2,
      stdout: [
        'Checked against @org/contract-orders-service@1.0.0',
        'endpoints.GET /orders/{} (getOrder) schema field-removed at success.body.placedAt: Breaking, needs a Breaking Change Approval',
        'Would publish @org/contract-orders-service@2.0.0 (major)',
        '',
      ].join('\n'),
      stderr:
        '1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it\n',
    });
  });
});
