import { defineEndpoint, defineGroup, defineService } from '@cf-loom/contract';
import { handle, success, type WithResources } from '@cf-loom/handlers';
import Fastify, { type FastifyBaseLogger, type FastifyTypeProvider } from 'fastify';
import { describe, expect, test } from 'vitest';
import { selfSigned } from '../../test/h2.ts';
import { fastifyServe } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'The orders',
  success: { status: 204 },
});

const contract = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
});

const clock = { now: () => 0 };

const needsClock = handle(
  getOrder,
  (_input, _call, { resources }: WithResources<{ clock: typeof clock }>) => {
    resources.clock.now();
    return success(getOrder);
  },
);

const handlers = { endpoints: { getOrder: handle(getOrder, () => success(getOrder)) }, guards: {} };
const handlersWithClock = { endpoints: { getOrder: needsClock }, guards: {} };

describe('fastifyServe: what it takes', () => {
  test('serve’s options but fallback are accepted, written inline or through a variable', () => {
    const options = { maxBodyBytes: 1_024, onAnswered: () => undefined };

    const plugins = [
      fastifyServe(contract, handlers, {}),
      fastifyServe(contract, handlers, { maxBodyBytes: 'unlimited', onServiceFault: () => {} }),
      fastifyServe(contract, handlers, options),
    ];

    expect(plugins).toHaveLength(3);
  });

  test('a fallback, written inline or given through a variable, is a type error', () => {
    const options = { maxBodyBytes: 1_024, fallback: async () => new Response(null) };

    const serving = () => [
      // @ts-expect-error TS2353 fastifyServe hands the app what no Endpoint has, so it takes no fallback
      fastifyServe(contract, handlers, { fallback: async () => new Response(null) }),
      // @ts-expect-error TS2345 fastifyServe takes no fallback through a variable either
      fastifyServe(contract, handlers, options),
    ];

    expect(serving).toBeTypeOf('function');
  });

  test('an options variable holding a declared field and a misspelled one is a type error', () => {
    const options = { onAnswered: () => undefined, onAnswerd: () => undefined };

    // @ts-expect-error TS2345 onAnswerd is not a declared field
    const serving = () => fastifyServe(contract, handlers, options);

    expect(serving).toBeTypeOf('function');
  });

  test('options are always given', () => {
    // @ts-expect-error TS2554 fastifyServe always takes its options
    const serving = () => fastifyServe(contract, handlers);

    expect(serving).toBeTypeOf('function');
  });
});

describe('fastifyServe: the Resources, inferred from the Handler map', () => {
  test('resources are required when a Handler takes them, and typed by what it takes', () => {
    const mistyped = { resources: { clock: 'tick' } };

    const serving = () => [
      fastifyServe(contract, handlersWithClock, { resources: { clock } }),
      // @ts-expect-error TS2345 getOrder's Handler takes the clock
      fastifyServe(contract, handlersWithClock, {}),
      // @ts-expect-error TS2345 the clock is not what getOrder's Handler takes
      fastifyServe(contract, handlersWithClock, mistyped),
    ];

    expect(serving).toBeTypeOf('function');
  });
});

describe('fastifyServe: where it registers', () => {
  interface Provider extends FastifyTypeProvider {
    readonly validator: this['schema'] extends string ? number : unknown;
    readonly serializer: unknown;
  }

  test('the plugin registers on an app with a type provider', async () => {
    const app = Fastify().withTypeProvider<Provider>();

    await app.register(fastifyServe(contract, handlers, {}));

    expect(app.hasPlugin('fastifyServe')).toBe(true);
    await app.close();
  });

  test('the plugin registers on an app with a custom logger', async () => {
    const quiet = () => undefined;
    const logger: FastifyBaseLogger & { readonly custom: number } = {
      custom: 1,
      level: 'info',
      silent: quiet,
      trace: quiet,
      debug: quiet,
      info: quiet,
      warn: quiet,
      error: quiet,
      fatal: quiet,
      child: () => logger,
    };
    const app = Fastify({ loggerInstance: logger });

    await app.register(fastifyServe(contract, handlers, {}));

    expect(app.hasPlugin('fastifyServe')).toBe(true);
    await app.close();
  });

  test('the plugin registers on an HTTP/2 app, plaintext or over TLS with allowHTTP1', async () => {
    const { key, cert } = selfSigned();
    const h2c = Fastify({ http2: true });
    const overTls = Fastify({ http2: true, https: { allowHTTP1: true, key, cert } });

    await h2c.register(fastifyServe(contract, handlers, {}));
    await overTls.register(fastifyServe(contract, handlers, {}));

    expect([h2c.hasPlugin('fastifyServe'), overTls.hasPlugin('fastifyServe')]).toEqual([
      true,
      true,
    ]);
    await Promise.all([h2c.close(), overTls.close()]);
  });
});
