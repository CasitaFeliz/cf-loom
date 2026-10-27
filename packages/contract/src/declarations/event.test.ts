import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type BodyOf, defineEvent, openEnum } from '../index.ts';

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

  test('a version written in exponent form past the whole numbers is a type error', () => {
    const declare = () =>
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error a version is written without an exponent
        version: 1e21,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      });

    expect(declare).not.toThrow();
  });

  test('a version too large to be a number, which is Infinity, is a type error', () => {
    const declare = () =>
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error Infinity is no whole number
        // biome-ignore lint/correctness/noPrecisionLoss: the literal under test is too large for a number
        version: 1e999,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      });

    expect(declare).not.toThrow();
  });

  test('a version that is a union of two literals is a type error', () => {
    const oneOfTwo: 1 | 2 = 1 as 1 | 2;
    const declare = () =>
      defineEvent({
        name: 'OrderCreated',
        // @ts-expect-error a union of two versions is not one literal
        version: oneOfTwo,
        visibility: 'internal',
        description: 'An order was placed',
        body,
      });

    expect(declare).not.toThrow();
  });

  test('a body that is no object of its fields is a type error', () => {
    const base = {
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
    } as const;
    const either = z.union([z.object({ a: z.string() }), z.object({ b: z.int() })]);
    const declare = () => [
      // @ts-expect-error a string cannot grow
      defineEvent({ ...base, body: z.string() }),
      // @ts-expect-error a list cannot grow
      defineEvent({ ...base, body: z.array(z.object({ orderId: z.uuid() })) }),
      // @ts-expect-error a record is no object of its fields
      defineEvent({ ...base, body: z.record(z.string(), z.string()) }),
      // @ts-expect-error a union is no object of its fields
      defineEvent({ ...base, body: either }),
      // @ts-expect-error a nullable object is no object of its fields
      defineEvent({ ...base, body: z.object({ orderId: z.uuid() }).nullable() }),
    ];

    expect(declare).not.toThrow();
  });

  test('an object, an intersection, a lazy object and a recursive object are bodies', () => {
    const base = {
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
    } as const;
    const tree = z
      .object({
        value: z.string(),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const events = [
      defineEvent({ ...base, body }),
      defineEvent({ ...base, body: z.intersection(body, z.object({ total: z.int() })) }),
      defineEvent({ ...base, body: z.lazy(() => body) }),
      defineEvent({ ...base, body: tree }),
    ];

    expect(events.map((event) => event.kind)).toEqual(['event', 'event', 'event', 'event']);
  });

  test('a body typed as a plain zod schema, which only generate can judge, is not a type error', () => {
    const recursive: z.ZodType<{ readonly next?: unknown }> = z.object({
      next: z.lazy(() => recursive).optional(),
    });

    const orderCreated = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      body: recursive,
    });

    expect(orderCreated.body).toBe(recursive);
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

describe('BodyOf', () => {
  test('BodyOf of an own Event is what its writer writes, without the Unknown case', () => {
    const orderCreatedV2 = defineEvent({
      name: 'OrderCreated',
      version: 2,
      visibility: 'internal',
      description: 'An order was placed',
      body: z.object({ orderId: z.uuid(), status: openEnum(['pending', 'paid']) }),
    });

    expectTypeOf<BodyOf<typeof orderCreatedV2>>().toEqualTypeOf<{
      orderId: string;
      status: 'pending' | 'paid';
    }>();
    expectTypeOf<{ orderId: string; status: { unknown: string } }>().not.toExtend<
      BodyOf<typeof orderCreatedV2>
    >();
  });
});
