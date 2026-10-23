import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');

describe('the broker plan', () => {
  test('cf-loom broker-plan --json prints no stream, and a durable consumer on orders-service’s stream', () => {
    const ran = spawnSync(process.execPath, [bin, 'broker-plan', '--json'], {
      cwd: serviceDir,
      encoding: 'utf8',
    });

    expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(ran.stdout)).toEqual({
      prefix: null,
      streams: {},
      consumers: {
        'billing-service_draft-invoice-on-created': {
          service: 'billing-service',
          stream: 'orders-service',
          subject: 'orders-service.event.OrderCreated.v1',
        },
      },
    });
  });
});
