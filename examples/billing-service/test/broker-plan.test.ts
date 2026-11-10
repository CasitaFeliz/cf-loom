import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runProcess } from '../../../packages/messaging/test/test-process.ts';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');

describe('the broker plan', () => {
  test('cf-loom broker-plan --json prints no stream, and a Durable consumer on orders-service’s stream', async () => {
    const ran = await runProcess(process.execPath, [bin, 'broker-plan', '--json'], {
      cwd: serviceDir,
    });

    expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(ran.stdout).plan).toEqual({
      prefix: null,
      streams: {},
      durableConsumers: {
        'billing-service_draft-invoice-on-created': {
          service: 'billing-service',
          stream: 'orders-service',
          subject: 'orders-service.event.OrderCreated.v1',
        },
      },
    });
  });
});
