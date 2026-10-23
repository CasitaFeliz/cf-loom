import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { billingEnvironment, ordersEnvironment } from './environments.ts';
import { aServiceProcess } from './service-process.ts';

const ordersDir = join(import.meta.dirname, '../../orders-service');
const billingDir = join(import.meta.dirname, '..');

/** Why a Service did not start, or `started` after stopping the Service that did. */
async function whyNotStarted(serviceDir: string, env: Record<string, string>): Promise<string> {
  try {
    const service = await aServiceProcess(serviceDir, env);
    await service.stop();
    return 'started';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('a Service’s main.ts with NATS_URL empty', () => {
  test('orders-service exits before it connects, naming NATS_URL', async () => {
    const why = await whyNotStarted(ordersDir, ordersEnvironment(''));

    expect(why).toContain('NATS_URL is not set or empty');
  });

  test('billing-service exits before it connects, naming NATS_URL', async () => {
    const why = await whyNotStarted(billingDir, billingEnvironment('', 'http://127.0.0.1:1'));

    expect(why).toContain('NATS_URL is not set or empty');
  });
});
