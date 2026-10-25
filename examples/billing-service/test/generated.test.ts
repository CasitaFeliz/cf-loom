import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');
const snapshot = JSON.parse(readFileSync(join(serviceDir, 'contract.snapshot.json'), 'utf8'));

describe('the committed generated files', () => {
  test('cf-loom verify finds them up to date', () => {
    const verified = spawnSync(process.execPath, [bin, 'verify'], {
      cwd: serviceDir,
      encoding: 'utf8',
    });

    expect({ status: verified.status, stderr: verified.stderr }).toEqual({ status: 0, stderr: '' });
  });
});

describe('the Snapshot', () => {
  test('money in an invoice’s total carries its origin from @org/definitions', () => {
    const total = snapshot.endpoints['POST /invoices'].success.body.fields.total.schema;

    const origin = total.origin;

    expect(origin).toBe('@org/definitions@0.0.0#money');
  });

  test('the Subscription to orders-service’s OrderCreated@1 is recorded by its Provider, and the Dependency only by its Endpoints', () => {
    const subscription = snapshot.subscriptions.draftInvoiceOnCreated;
    const dependency = snapshot.dependencies['orders-service'];

    expect(subscription.event).toBe('orders-service:OrderCreated@1');
    expect(dependency).toEqual({
      against: '0.0.0',
      endpoints: [{ id: 'GET /orders/{}', name: 'getOrder' }],
    });
  });
});
