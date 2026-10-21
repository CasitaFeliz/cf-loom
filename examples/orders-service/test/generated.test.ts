import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
const snapshot = JSON.parse(readFileSync(join(serviceDir, 'contract.snapshot.json'), 'utf8'));
const outDir = mkdtempSync(join(tmpdir(), 'orders-contract-package-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function cfLoom(...args: string[]) {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: serviceDir, encoding: 'utf8' });
  return { status: ran.status, stderr: ran.stderr };
}

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

  test('cf-loom package writes exactly the committed Contract Package', () => {
    const packaged = cfLoom('package', '--out', outDir);

    expect(packaged).toEqual({ status: 0, stderr: '' });
    expect(filesOf(outDir)).toEqual(filesOf(join(serviceDir, 'contract-package')));
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
  test('the Contract Package writes money in and imports nothing from @org/definitions', () => {
    const files = filesOf(join(serviceDir, 'contract-package'));
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

  test('the Contract Package exports OrderCreated@1 and nothing of ChargeCard or charge-on-created', () => {
    const files = filesOf(join(serviceDir, 'contract-package'));

    const events = Object.keys(files).filter((path) => path.startsWith('src/events/'));
    const exported = [files['src/index.ts'], files['src/exported-snapshot.ts']].join('\n');

    expect(events).toEqual(['src/events/order-created.v1.ts']);
    expect(exported).toContain('OrderCreated@1');
    expect(exported).not.toMatch(/ChargeCard|charge-on-created/i);
  });
});
