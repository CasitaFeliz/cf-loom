// biome-ignore-all lint/style/useNamingConvention: the environment variables the Services read
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { billingEnvironment, ordersEnvironment } from './environments.ts';
import { aServiceProcess } from './service-process.ts';

const ordersDir = join(import.meta.dirname, '../../orders-service');
const billingDir = join(import.meta.dirname, '..');
const noConnections = pathToFileURL(join(import.meta.dirname, 'no-connections.ts')).href;

/** Starts a Service that cannot open a connection, and answers why it did not start, or `started` after stopping it. */
async function whyNotStarted(serviceDir: string, env: Record<string, string>): Promise<string> {
  try {
    const service = await aServiceProcess(serviceDir, {
      ...env,
      NODE_OPTIONS: `--import=${noConnections}`,
    });
    await service.stop();
    return 'started';
  } catch (error) {
    return (error as Error).message;
  }
}

describe('billing-service’s main.ts with a setting of the orders client empty', () => {
  const natsUrl = 'nats://127.0.0.1:1';

  test('it refuses to start with ORDERS_SERVICE_URL empty, naming it, before any connection', async () => {
    const why = await whyNotStarted(billingDir, billingEnvironment(natsUrl, ''));

    expect(why).toContain('ORDERS_SERVICE_URL is not set or empty');
    expect(why).not.toContain('tried to open a connection');
  });

  test('it refuses to start with ORDERS_SERVICE_API_KEY empty, naming it, before any connection', async () => {
    const env = {
      ...billingEnvironment(natsUrl, 'http://127.0.0.1:1'),
      ORDERS_SERVICE_API_KEY: '',
    };

    const why = await whyNotStarted(billingDir, env);

    expect(why).toContain('ORDERS_SERVICE_API_KEY is not set or empty');
    expect(why).not.toContain('tried to open a connection');
  });
});

describe('a Service’s main.ts with NATS_URL empty', () => {
  test('orders-service refuses to start with NATS_URL empty, naming it', async () => {
    const why = await whyNotStarted(ordersDir, ordersEnvironment(''));

    expect(why).toContain('NATS_URL is not set or empty');
    expect(why).not.toContain('tried to open a connection');
  });

  test('billing-service refuses to start with NATS_URL empty, naming it', async () => {
    const why = await whyNotStarted(billingDir, billingEnvironment('', 'http://127.0.0.1:1'));

    expect(why).toContain('NATS_URL is not set or empty');
    expect(why).not.toContain('tried to open a connection');
  });
});
