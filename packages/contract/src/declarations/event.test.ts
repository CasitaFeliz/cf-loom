import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { defineEvent } from '../index.ts';

const body = z.object({ orderId: z.uuid() });

describe('defineEvent', () => {
  test('an Event keeps what was written with its kind, its body the author’s schema', () => {
    const orderCreatedV2 = defineEvent({
      name: 'OrderCreated',
      version: 2,
      visibility: 'internal',
      description: 'An order was placed',
      body,
    });

    expect(orderCreatedV2).toEqual({
      kind: 'event',
      name: 'OrderCreated',
      version: 2,
      visibility: 'internal',
      description: 'An order was placed',
      body,
    });
    expect(orderCreatedV2.body).toBe(body);
  });

  test('an Event freezes its declaration', () => {
    const orderCreatedV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'private',
      description: 'An order was placed',
      body,
    });

    expect(Object.isFrozen(orderCreatedV1)).toBe(true);
  });

  test('a Public Event is a type error', () => {
    const declare = () =>
      defineEvent({
        name: 'OrderCreated',
        version: 1,
        // @ts-expect-error a Message travels only through the broker
        visibility: 'public',
        description: 'An order was placed',
        body,
      });

    expect(declare).not.toThrow();
  });

  test('an Event without a body is a type error', () => {
    const declare = () =>
      // @ts-expect-error every Message Version declares its body
      defineEvent({
        name: 'OrderCreated',
        version: 1,
        visibility: 'internal',
        description: 'An order was placed',
      });

    expect(declare).not.toThrow();
  });

  test('an undeclared field on an Event is a type error', () => {
    const declare = () =>
      defineEvent({
        name: 'OrderCreated',
        version: 1,
        visibility: 'internal',
        description: 'An order was placed',
        body,
        // @ts-expect-error an Event declares no headers
        headers: z.object({}),
      });

    expect(declare).not.toThrow();
  });

  test('a version that is not a whole number from 1 is a type error', () => {
    const declare = () => [
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error versions count from 1
        version: 0,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      }),
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error a version is a whole number
        version: 1.5,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      }),
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error a version written in exponent form is still a fraction
        version: 1e-7,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('an Event’s name, version and lifecycle stay literal in its type', () => {
    const orderCreatedV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      lifecycle: 'deprecated',
      body,
    });

    expectTypeOf(orderCreatedV1.name).toEqualTypeOf<'OrderCreated'>();
    expectTypeOf(orderCreatedV1.version).toEqualTypeOf<1>();
    expectTypeOf(orderCreatedV1.lifecycle).toEqualTypeOf<'deprecated'>();
    expect(orderCreatedV1.lifecycle).toBe('deprecated');
  });
});
