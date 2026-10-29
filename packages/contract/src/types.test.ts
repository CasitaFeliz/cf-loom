import { describe, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type ApplicationContract,
  type Command,
  type Definitions,
  type DemandsOf,
  type Dependency,
  defineEndpoint,
  defineGuard,
  type Endpoint,
  type Event,
  type Group,
  type Guard,
  type InputOf,
  type Issue,
  type ProvidedEndpoint,
  type ProvidedStandardRejections,
  type QualifiedAttachment,
  type Rejection,
  type ServiceContract,
  type StandardRejection,
  type StandardRejections,
  type Subscription,
  type SuccessOf,
} from './index.ts';

/** Every key any member of a union of records holds. */
type KeysOfEach<Record> = Record extends unknown ? keyof Record : never;

const putOrder = defineEndpoint({
  name: 'putOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Replaces an order',
  input: {
    params: z.object({ orderId: z.string() }),
    query: z.object({ dryRun: z.string().optional() }),
    headers: z.object({ 'x-trace': z.string() }),
    body: z.object({ total: z.number() }),
  },
  success: {
    status: 200,
    headers: z.object({ etag: z.string() }),
    body: z.object({ orderId: z.string() }),
  },
});

const rateLimited = defineGuard({
  name: 'rateLimited',
  description: 'Counts the requests of a client',
  demands: {
    headers: z.object({ 'x-client': z.string() }),
    query: z.object({ burst: z.string() }),
  },
});

describe('the records a Contract declares', () => {
  test('an Endpoint holds its name, method, path, Visibility, description, Input, Success, Guards, Rejections and lifecycle, and no more', () => {
    expectTypeOf<KeysOfEach<Endpoint>>().toEqualTypeOf<
      | 'kind'
      | 'name'
      | 'method'
      | 'path'
      | 'visibility'
      | 'description'
      | 'input'
      | 'success'
      | 'guards'
      | 'rejections'
      | 'lifecycle'
      | 'deprecatedAt'
    >();
  });

  test('an Event holds its name, version, Visibility, description, body and lifecycle, and no more', () => {
    expectTypeOf<keyof Event>().toEqualTypeOf<
      'kind' | 'name' | 'version' | 'visibility' | 'description' | 'body' | 'lifecycle'
    >();
  });

  test('a Command holds its name, version, description, body and lifecycle, and no Visibility', () => {
    expectTypeOf<keyof Command>().toEqualTypeOf<
      'kind' | 'name' | 'version' | 'description' | 'body' | 'lifecycle'
    >();
  });

  test('a Guard holds its name, description, demands, Guards, context, Qualifier and Rejections, and no more', () => {
    expectTypeOf<keyof Guard>().toEqualTypeOf<
      | 'kind'
      | 'name'
      | 'description'
      | 'demands'
      | 'guards'
      | 'context'
      | 'qualifier'
      | 'rejections'
    >();
  });

  test('a Rejection holds its code, status, message, headers and body, and no more', () => {
    expectTypeOf<keyof Rejection>().toEqualTypeOf<
      'kind' | 'code' | 'status' | 'message' | 'headers' | 'body'
    >();
  });

  test('a Subscription holds its name, description and Event, and no more', () => {
    expectTypeOf<keyof Subscription>().toEqualTypeOf<'kind' | 'name' | 'description' | 'event'>();
  });

  test('a Group holds its name, description, Endpoints, Events, Commands and Subscriptions, and no more', () => {
    expectTypeOf<keyof Group>().toEqualTypeOf<
      'kind' | 'name' | 'description' | 'endpoints' | 'events' | 'commands' | 'subscriptions'
    >();
  });

  test('a Dependency holds its Endpoints, and no more', () => {
    expectTypeOf<keyof Dependency>().toEqualTypeOf<'kind' | 'endpoints'>();
  });

  test('a QualifiedAttachment holds a Guard and its Qualifier, and no more', () => {
    expectTypeOf<keyof QualifiedAttachment>().toEqualTypeOf<'guard' | 'qualifier'>();
  });
});

describe('the records a Contract is the Root of', () => {
  test('a ServiceContract holds its name, Standard Rejections, Groups and Dependencies, and no more', () => {
    expectTypeOf<keyof ServiceContract>().toEqualTypeOf<
      'kind' | 'name' | 'standardRejections' | 'groups' | 'dependencies'
    >();
  });

  test('an ApplicationContract holds its name and Dependencies, and no more', () => {
    expectTypeOf<keyof ApplicationContract>().toEqualTypeOf<'kind' | 'name' | 'dependencies'>();
  });

  test('a Definitions Package holds its Standard Rejections, and no more', () => {
    expectTypeOf<keyof Definitions>().toEqualTypeOf<'kind' | 'standardRejections'>();
  });

  test('a StandardRejection holds its name, and no more', () => {
    expectTypeOf<keyof StandardRejection>().toEqualTypeOf<'kind' | 'name'>();
  });

  test('StandardRejections hold the invalid-input, not-found and not-implemented ones, and no more', () => {
    expectTypeOf<keyof StandardRejections>().toEqualTypeOf<
      'invalidInput' | 'notFound' | 'notImplemented'
    >();
  });
});

describe('the records a Contract Package exports', () => {
  test('a ProvidedEndpoint holds an Endpoint’s keys, and no more a Service can name', () => {
    expectTypeOf<Exclude<KeysOfEach<ProvidedEndpoint>, symbol>>().toEqualTypeOf<
      | 'kind'
      | 'name'
      | 'method'
      | 'path'
      | 'visibility'
      | 'description'
      | 'input'
      | 'success'
      | 'guards'
      | 'rejections'
      | 'lifecycle'
      | 'deprecatedAt'
    >();
  });

  test('ProvidedStandardRejections hold the invalid-input, not-found and not-implemented ones, and no more', () => {
    expectTypeOf<keyof ProvidedStandardRejections>().toEqualTypeOf<
      'invalidInput' | 'notFound' | 'notImplemented'
    >();
  });
});

describe('the records a Handler and a Caller read', () => {
  test('an Issue holds its part, path, code and message, and no more', () => {
    expectTypeOf<keyof Issue>().toEqualTypeOf<'part' | 'path' | 'code' | 'message'>();
  });

  test('an Input holds one key per part an Endpoint declares: params, query, headers and body', () => {
    expectTypeOf<keyof InputOf<typeof putOrder>>().toEqualTypeOf<
      'params' | 'query' | 'headers' | 'body'
    >();
  });

  test('demands hold one key per part a Guard demands: headers and query', () => {
    expectTypeOf<keyof DemandsOf<typeof rateLimited>>().toEqualTypeOf<'headers' | 'query'>();
  });

  test('a Success holds the status, headers and body an Endpoint declares, and no more', () => {
    expectTypeOf<keyof SuccessOf<typeof putOrder>>().toEqualTypeOf<'status' | 'headers' | 'body'>();
  });
});
