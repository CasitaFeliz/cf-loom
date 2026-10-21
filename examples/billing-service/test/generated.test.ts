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

  test('the Subscription to orders-service’s OrderCreated@1 is recorded with the Dependency on it', () => {
    const subscription = snapshot.subscriptions['draft-invoice-on-created'];
    const dependencyEvents = snapshot.dependencies['orders-service'].events;

    expect(subscription.event).toBe('orders-service:OrderCreated@1');
    expect(dependencyEvents).toEqual(['OrderCreated@1']);
  });
});
