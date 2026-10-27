import {
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
} from '@cf-loom/contract';
import { describe, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import type {
  Admission,
  CheckedAdmission,
  CheckedOutcome,
  DirectMeta,
  EndpointCall,
  Fault,
  GuardCall,
  HandledBy,
  HandledRequest,
  HandlerMap,
  HandlerMapOf,
  InvalidCallError,
  InvalidOutcomeError,
  MessageFault,
  MessageMeta,
  NoResources,
  Outcome,
  Pairing,
  Readers,
  WithResources,
} from './index.ts';

/** Every key any member of a union of records holds. */
type KeysOfEach<Record> = Record extends unknown ? keyof Record : never;

const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const rateLimited = defineRejection({
  code: 'RATE_LIMITED',
  status: 429,
  message: 'Slow down',
  headers: z.object({ 'x-retry-in': z.int().min(0) }),
  body: z.object({ limit: z.int() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The Caller holds every listed permission',
  guards: [apiKey],
  qualifier: z.array(z.string()),
  rejections: [rateLimited],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey, { guard: permission, qualifier: ['orders:read'] }],
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ orderId: z.string() }) },
  rejections: [gone, orderLocked, rateLimited],
});

const orders = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
});

describe('the records a Service reads off a Handler', () => {
  test('a HandledBy brand holds a declaration and nothing else a Service can name', () => {
    expectTypeOf<Exclude<keyof HandledBy<Endpoint>, symbol>>().toEqualTypeOf<'declaration'>();
  });

  test('a Pairing holds a declaration and its Reader, and nothing else', () => {
    expectTypeOf<keyof Pairing>().toEqualTypeOf<'declaration' | 'reader'>();
  });

  test('a HandledRequest holds the signal and headers of the request, and no more', () => {
    expectTypeOf<keyof HandledRequest>().toEqualTypeOf<'signal' | 'headers'>();
  });

  test('a MessageMeta holds the Message’s ids, attempt, headers and signal, and no more', () => {
    expectTypeOf<keyof MessageMeta>().toEqualTypeOf<
      'messageId' | 'factId' | 'deliveryCount' | 'lastAttempt' | 'headers' | 'signal'
    >();
  });

  test('a DirectMeta holds each part of a MessageMeta, optional', () => {
    expectTypeOf<DirectMeta>().toEqualTypeOf<Partial<MessageMeta>>();
  });

  test('an EndpointCall holds the Context and the request, and no more', () => {
    expectTypeOf<keyof EndpointCall<typeof getOrder>>().toEqualTypeOf<'context' | 'request'>();
  });

  test('a GuardCall holds the Context and the request, and the Qualifier only of a Guard that declares one', () => {
    expectTypeOf<keyof GuardCall<typeof apiKey>>().toEqualTypeOf<'context' | 'request'>();
    expectTypeOf<keyof GuardCall<typeof permission>>().toEqualTypeOf<
      'context' | 'qualifier' | 'request'
    >();
  });

  test('WithResources hold the Resources, and no more', () => {
    expectTypeOf<keyof WithResources<{ readonly orders: string }>>().toEqualTypeOf<'resources'>();
  });

  test('NoResources hold no key', () => {
    expectTypeOf<keyof NoResources>().toBeNever();
  });

  test('InvalidCallError and InvalidOutcomeError hold the Issues, beside an Error’s own', () => {
    expectTypeOf<Exclude<keyof InvalidCallError, keyof Error>>().toEqualTypeOf<'issues'>();
    expectTypeOf<Exclude<keyof InvalidOutcomeError, keyof Error>>().toEqualTypeOf<'issues'>();
  });
});

describe('the Handler map', () => {
  test('a HandlerMap holds the Endpoints, Guards, Commands, Subscriptions and Readers, and no more', () => {
    expectTypeOf<keyof HandlerMap>().toEqualTypeOf<
      'endpoints' | 'guards' | 'commands' | 'subscriptions' | 'readers'
    >();
  });

  test('a HandlerMapOf a Contract holds the same five, and no more', () => {
    expectTypeOf<keyof HandlerMapOf<typeof orders>>().toEqualTypeOf<
      'endpoints' | 'guards' | 'commands' | 'subscriptions' | 'readers'
    >();
  });

  test('Readers hold the Commands’ and the Subscriptions’ Readers, and no more', () => {
    expectTypeOf<keyof Readers>().toEqualTypeOf<'commands' | 'subscriptions'>();
  });
});

describe('what a Handler builds and a direct call returns', () => {
  test('a Fault holds its message, whether it committed and may be retried, and when and why, and no more', () => {
    expectTypeOf<KeysOfEach<Fault>>().toEqualTypeOf<
      'kind' | 'committed' | 'retryable' | 'retryAfter' | 'message' | 'cause'
    >();
  });

  test('a MessageFault holds the same six', () => {
    expectTypeOf<KeysOfEach<MessageFault>>().toEqualTypeOf<
      'kind' | 'committed' | 'retryable' | 'retryAfter' | 'message' | 'cause'
    >();
  });

  test('an Outcome holds a Success’s value, a Rejection’s declaration, headers and body, and a Fault’s keys, and no more', () => {
    expectTypeOf<KeysOfEach<Outcome<typeof getOrder>>>().toEqualTypeOf<
      | 'kind'
      | 'value'
      | 'rejection'
      | 'headers'
      | 'body'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });

  test('a CheckedOutcome holds the Success’s status where an Outcome holds its value, and no more', () => {
    expectTypeOf<KeysOfEach<CheckedOutcome<typeof getOrder>>>().toEqualTypeOf<
      | 'kind'
      | 'status'
      | 'body'
      | 'rejection'
      | 'headers'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });

  test('an Admission holds the admitted Context, a Rejection’s declaration, headers and body, and a Fault’s keys, and no more', () => {
    expectTypeOf<KeysOfEach<Admission<typeof permission>>>().toEqualTypeOf<
      | 'kind'
      | 'context'
      | 'rejection'
      | 'headers'
      | 'body'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });

  test('a CheckedAdmission holds the same ten as an Admission', () => {
    expectTypeOf<KeysOfEach<CheckedAdmission<typeof permission>>>().toEqualTypeOf<
      | 'kind'
      | 'context'
      | 'rejection'
      | 'headers'
      | 'body'
      | 'committed'
      | 'retryable'
      | 'retryAfter'
      | 'message'
      | 'cause'
    >();
  });
});
