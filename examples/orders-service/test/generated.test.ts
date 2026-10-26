import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
const snapshot = JSON.parse(readFileSync(join(serviceDir, 'contract.snapshot.json'), 'utf8'));
const outDir = mkdtempSync(join(tmpdir(), 'orders-contract-package-'));

function cfLoom(...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: serviceDir, encoding: 'utf8' });
  return { status: ran.status, stderr: ran.stderr };
}

let packaged: ReturnType<typeof cfLoom>;

beforeAll(() => {
  packaged = cfLoom('package', '--out', outDir);
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/** Every file `cf-loom package` writes under `dir`, by its path, leaving out a build's and an install's. */
function filesOf(dir: string): Record<string, string> {
  const dirents = readdirSync(dir, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const dirent of dirents) {
    const path = relative(dir, join(dirent.parentPath, dirent.name));
    const isBuildOrInstall = path.startsWith('dist') || path.startsWith('node_modules');
    if (dirent.isFile() && !isBuildOrInstall) {
      files[path] = readFileSync(join(dir, path), 'utf8');
    }
  }
  return files;
}

describe('the committed generated files', () => {
  test('cf-loom verify finds them up to date', () => {
    const verified = cfLoom('verify');

    expect(verified).toEqual({ status: 0, stderr: '' });
  });
});

describe('the Snapshot', () => {
  test('money in an order’s total carries its origin from @org/definitions', () => {
    const totals = [
      snapshot.endpoints['POST /orders'].input.body.fields.total.schema,
      snapshot.endpoints['GET /orders/{}'].success.body.fields.total.schema,
    ];

    const origins = totals.map((total) => total.origin);

    expect(origins).toEqual(['@org/definitions@0.0.0#money', '@org/definitions@0.0.0#money']);
  });

  test('money in OrderCreated’s and ChargeCard’s total carries its origin from @org/definitions', () => {
    const totals = [
      snapshot.events['OrderCreated@1'].body.fields.total.schema,
      snapshot.commands['ChargeCard@1'].body.fields.total.schema,
    ];

    const origins = totals.map((total) => total.origin);

    expect(origins).toEqual(['@org/definitions@0.0.0#money', '@org/definitions@0.0.0#money']);
  });

  test('the imported Guard and its Rejection carry the origin of @org/definitions', () => {
    const origins = [snapshot.guards.apiKey.origin, snapshot.codes.UNAUTHENTICATED.origin];

    expect(origins).toEqual(['@org/definitions@0.0.0', '@org/definitions@0.0.0']);
  });
});

describe('the Contract Package', () => {
  test('the Contract Package billing links is the one cf-loom package writes from the committed Snapshot', () => {
    const linked = filesOf(join(serviceDir, '.cf-loom/contract-package'));

    expect(packaged).toEqual({ status: 0, stderr: '' });
    expect(linked).toEqual(filesOf(outDir));
  });

  test('the Contract Package writes money in and imports nothing from @org/definitions', () => {
    const files = filesOf(outDir);
    const manifest = JSON.parse(files['package.json'] ?? '{}');

    const importing = Object.keys(files).filter((path) =>
      /(from|import)\s*\(?\s*['"]@org\/definitions['"]/.test(files[path] ?? ''),
    );

    expect(files['src/endpoints/create-order.ts']).toContain(
      'total: z.object({ amount: z.int().min(0)',
    );
    expect(files['src/events/order-created.v1.ts']).toContain(
      'total: z.object({ amount: z.int().min(0)',
    );
    expect(importing).toEqual([]);
    expect(manifest.peerDependencies).not.toHaveProperty(['@org/definitions']);
    expect(manifest).not.toHaveProperty('dependencies');
  });

  test('the Contract Package exports OrderCreated@1 and nothing of ChargeCard or chargeOnCreated', () => {
    const files = filesOf(outDir);

    const events = Object.keys(files).filter((path) => path.startsWith('src/events/'));
    const sources = Object.keys(files)
      .filter((path) => path.endsWith('.ts'))
      .map((path) => files[path])
      .join('\n');

    expect(events).toEqual(['src/events/order-created.v1.ts']);
    expect(files['src/index.ts']).toContain('orderCreatedV1: orderCreatedEventV1');
    expect(sources).not.toMatch(/ChargeCard|chargeOnCreated/i);
  });
});
