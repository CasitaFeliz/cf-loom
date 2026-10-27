import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const serviceDir = join(import.meta.dirname, '..');
const bin = join(serviceDir, 'node_modules/@cf-loom/cli/dist/bin.js');

describe('the broker plan', () => {
  test('cf-loom broker-plan --json prints the stream and the two Durable consumers the Service needs', () => {
    const ran = spawnSync(process.execPath, [bin, 'broker-plan', '--json'], {
      cwd: serviceDir,
      encoding: 'utf8',
    });

    expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(ran.stdout).plan).toEqual({
      prefix: null,
      streams: {
        'orders-service': {
          service: 'orders-service',
          subjects: [
            'orders-service.command.ChargeCard.v1',
            'orders-service.event.OrderCreated.v1',
          ],
        },
      },
      durableConsumers: {
        'orders-service_charge-on-created': {
          service: 'orders-service',
          stream: 'orders-service',
          subject: 'orders-service.event.OrderCreated.v1',
        },
        'orders-service_command_ChargeCard_v1': {
          service: 'orders-service',
          stream: 'orders-service',
          subject: 'orders-service.command.ChargeCard.v1',
        },
      },
    });
  });
});
