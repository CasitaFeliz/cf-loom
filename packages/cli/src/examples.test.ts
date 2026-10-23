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

const rootDir = join(import.meta.dirname, '..', '..', '..');
const examplesDir = join(rootDir, 'examples');
const examplesTimeout = 120_000;

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

/** A copy of an example in `folder`, without its installed packages and Contract Package, with each package linked in. */
function aCopyOf(example: string, folder: string): string {
  const source = join(examplesDir, example);
  const copy = mkdtempSync(join(folder, `${example}-`));
  const isLeftOut = (path: string) =>
    basename(path) === 'node_modules' || path === join(source, 'contract-package');
  cpSync(source, copy, { recursive: true, filter: (path) => !isLeftOut(path) });
  const installed = readdirSync(join(source, 'node_modules')).filter((name) => name !== '.cache');
  for (const name of installed) {
    link(join(source, 'node_modules', name), join(copy, 'node_modules', name));
  }
  link(join(rootDir, 'node_modules/typescript'), join(copy, 'node_modules/typescript'));
  return copy;
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
    const copy = aCopyOf(example, folder);
    if (example === 'org-definitions') {
      withoutPrivate(copy);
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
      const folder = mkdtempSync(join(tmpdir(), 'cf-loom-examples-'));
      const registry = await aRegistry();
      try {
        await use(await publishedExamplesIn(folder, registry));
      } finally {
        await registry.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    { scope: 'file' },
  ],
});

describe('cf-loom publish and check on the examples', { timeout: examplesTimeout }, () => {
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
    const published = registry.published.map(({ name, version }) => `${name}@${version}`);
    expect(published).toEqual(publishedExamples.map(({ packageName }) => `${packageName}@1.0.0`));
  });

  test('removing a Success field from GET /orders/:orderId needs a Breaking Change Approval, and check exits 2', async ({
    examples,
  }) => {
    const { folder, env } = examples;
    const orders = aCopyOf('orders-service', folder);
    const getOrder = join(orders, 'src/contract/endpoints/orders/get-order.endpoint.ts');
    replacedIn(getOrder, 'body: order }', 'body: order.omit({ placedAt: true }) }');
    const generated = await cfLoomWith(orders, env, 'generate');
    expect(generated).toMatchObject({ status: 0, stderr: '' });

    const checked = await cfLoomWith(orders, env, 'check');

    expect(checked).toEqual({
      status: 2,
      stdout: [
        'Checked against @org/contract-orders-service@1.0.0',
        'endpoints.GET /orders/{} schema field-removed at success.body.fields.placedAt (success): Breaking, needs a Breaking Change Approval',
        '',
      ].join('\n'),
      stderr:
        '1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it\n',
    });
  });
});
