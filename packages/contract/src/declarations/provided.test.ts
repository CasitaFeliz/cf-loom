import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  defineEndpoint,
  defineEvent,
  defineRejection,
  type InputOf,
  openEnum,
  openEnumReader,
  providedEndpoint,
  providedEvent,
  providedRejection,
  type SuccessOf,
} from '../index.ts';

const trackOrder = {
  name: 'trackOrder',
  method: 'GET',
  path: '/orders/:orderId/track',
  visibility: 'public',
  description: 'Where an order stands',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ stage: openEnum(['packed', 'shipped']) }) },
} as const;

const orderPaid = {
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ stage: openEnum(['packed', 'shipped']) }),
} as const;

const orderLocked = {
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ reason: openEnum(['paid', 'shipped']) }),
} as const;

describe('the provided-Element constructors', () => {
  test('a provided Endpoint is the declaration, frozen and kept by identity, as defineEndpoint returns it', () => {
    const endpoint = providedEndpoint(trackOrder);

    expect(endpoint).toEqual(defineEndpoint(trackOrder));
    expect(endpoint.success.body).toBe(trackOrder.success.body);
    expect(Object.isFrozen(endpoint)).toBe(true);
  });

  test('a provided Event is the declaration, frozen and kept by identity, as defineEvent returns it', () => {
    const event = providedEvent(orderPaid);

    expect(event).toEqual(defineEvent(orderPaid));
    expect(event.body).toBe(orderPaid.body);
    expect(Object.isFrozen(event)).toBe(true);
  });

  test('a provided Rejection is the declaration, frozen and kept by identity, as defineRejection returns it', () => {
    const rejection = providedRejection(orderLocked);

    expect(rejection).toEqual(defineRejection(orderLocked));
    expect(rejection.body).toBe(orderLocked.body);
    expect(Object.isFrozen(rejection)).toBe(true);
  });

  test('an Open Enum’s Reader compiles in a provided Endpoint’s Success body, a provided Event’s and a provided Rejection’s', () => {
    const endpoint = providedEndpoint({
      ...trackOrder,
      success: { status: 200, body: z.object({ stage: openEnumReader(['packed', 'shipped']) }) },
    });
    const event = providedEvent({
      ...orderPaid,
      body: z.object({ stage: openEnumReader(['packed', 'shipped']) }),
    });
    const rejection = providedRejection({
      ...orderLocked,
      body: z.object({ reason: openEnumReader(['paid', 'shipped']) }),
    });

    expect([endpoint.kind, event.kind, rejection.kind]).toEqual(['endpoint', 'event', 'rejection']);
  });

  test('a provided Endpoint types InputOf and SuccessOf as defineEndpoint does', () => {
    const provided = providedEndpoint(trackOrder);
    const defined = defineEndpoint(trackOrder);

    expectTypeOf<InputOf<typeof provided>>().toEqualTypeOf<InputOf<typeof defined>>();
    expectTypeOf<SuccessOf<typeof provided>>().toEqualTypeOf<SuccessOf<typeof defined>>();
    expectTypeOf<typeof provided>().toEqualTypeOf<typeof defined>();
  });
});
