import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resetServiceCode } from '../src/service-code.ts';

const customerId = '3b241101-e2bb-4255-8caf-4136c566a962';

beforeEach(() => {
  resetServiceCode();
  vi.resetModules();
});

let opened: { close(): PromiseLike<unknown> } | undefined;

afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

/** The Fastify app of the server README’s fastify block, as the README Service writes it out. */
async function readmeApp() {
  const { app } = await import('../snippets/server-fastify.ts');
  opened = app;
  return app;
}

describe('the server README’s fastify', () => {
  test('the README’s app answers its own /healthz and serves a declared Endpoint: createOrder without its API key is the Guard’s Rejection', async () => {
    const app = await readmeApp();

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId, total: { amount: 1200, currency: 'EUR' } },
    });

    expect(health.statusCode).toBe(200);
    expect(health.body).toBe('ok');
    expect(created.statusCode).toBe(401);
    expect(created.json()).toMatchObject({ rejection: { code: 'UNAUTHENTICATED' } });
  });

  test('an undeclared path of the README’s app is Fastify’s 404', async () => {
    const app = await readmeApp();

    const response = await app.inject({ method: 'GET', url: '/customers' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'Not Found' });
  });
});
