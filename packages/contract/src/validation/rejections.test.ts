import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  invalidInput,
  notFound,
  notImplemented,
  type Rejection,
  type RejectionStatus,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
}

function noOrigin() {
  return undefined;
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const creating = {
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Creates an order',
  success: { status: 201, body: z.object({ id: z.uuid() }) },
} as const;

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

function validateEndpoints(endpoints: readonly [Endpoint, ...Endpoint[]]) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints });
  return validateInPackage(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: Rejection statuses', () => {
  test('a Rejection with a 4xx status validates', () => {
    const endpoint = defineEndpoint({ ...listing, rejections: [orderLocked] });

    expect(validateEndpoints([endpoint]).kind).toBe('valid');
  });

  test('a Rejection with a status outside 4xx fails', () => {
    const status = 500 as RejectionStatus;
    const failing = defineRejection({ code: 'UPSTREAM_DOWN', status, message: 'Down' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [failing] })])).toEqual(
      failed(
        ['rejections', 'UPSTREAM_DOWN', 'status'],
        'rejection-status',
        "A Rejection's status is 4xx: 500",
      ),
    );
  });

  test('a Standard Rejection a Definitions Package declares with a status outside 4xx fails', () => {
    const status = 200 as RejectionStatus;
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'NOT_FOUND', status, message: 'Not found' } },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'status'],
        'rejection-status',
        "A Rejection's status is 4xx: 200",
      ),
    );
  });

  test('the not-implemented Rejection with a status other than 501 fails', () => {
    const status = 500 as 501;
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notImplemented: { code: 'NOT_IMPLEMENTED', status, message: 'Later' } },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notImplemented', 'status'],
        'rejection-status',
        "The not-implemented Rejection's status is 501: 500",
      ),
    );
  });
});

describe('validateContract: one status and one body per code', () => {
  test('two declarations of one code that agree validate', () => {
    const lockedAgain = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Another message',
      body: z.object({ lockedAt: z.iso.datetime() }),
    });
    const endpoints = [
      defineEndpoint({ ...listing, rejections: [orderLocked] }),
      defineEndpoint({ ...creating, rejections: [lockedAgain] }),
    ] as const;

    expect(validateEndpoints(endpoints).kind).toBe('valid');
  });

  test('two declarations of one code with different statuses fail', () => {
    const lockedAgain = defineRejection({ code: 'ORDER_LOCKED', status: 423, message: 'Locked' });
    const endpoints = [
      defineEndpoint({ ...listing, rejections: [orderLocked] }),
      defineEndpoint({ ...creating, rejections: [lockedAgain] }),
    ] as const;

    expect(validateEndpoints(endpoints)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['rejections', 'ORDER_LOCKED', 'status'],
          rule: 'code-status-conflict',
          message: 'A code has one HTTP status across the Contract: ORDER_LOCKED is 409 and 423',
        },
        {
          kind: 'declaration',
          at: ['rejections', 'ORDER_LOCKED', 'body'],
          rule: 'code-body-conflict',
          message: 'A code has one body schema across the Contract: ORDER_LOCKED',
        },
      ],
    });
  });

  test('two declarations of one code with different bodies fail', () => {
    const lockedAgain = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: z.object({ until: z.iso.datetime() }),
    });
    const endpoints = [
      defineEndpoint({ ...listing, rejections: [orderLocked] }),
      defineEndpoint({ ...creating, rejections: [lockedAgain] }),
    ] as const;

    expect(validateEndpoints(endpoints)).toEqual(
      failed(
        ['rejections', 'ORDER_LOCKED', 'body'],
        'code-body-conflict',
        'A code has one body schema across the Contract: ORDER_LOCKED',
      ),
    );
  });

  test('two declarations of one code whose bodies differ only in annotations agree', () => {
    const lockedAgain = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: z.object({ lockedAt: z.iso.datetime().describe('When it locked') }).describe('Lock'),
    });
    const endpoints = [
      defineEndpoint({ ...listing, rejections: [orderLocked] }),
      defineEndpoint({ ...creating, rejections: [lockedAgain] }),
    ] as const;

    expect(validateEndpoints(endpoints).kind).toBe('valid');
  });

  test('a Standard Rejection’s resolved code joins the one-status rule', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' } },
    });
    const missing = defineRejection({ code: 'NOT_FOUND', status: 410, message: 'Gone' });
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [defineEndpoint({ ...listing, rejections: [missing] })],
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [orders],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['rejections', 'NOT_FOUND', 'code'],
          rule: 'standard-code-redefined',
          message:
            'Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to: NOT_FOUND',
        },
        {
          kind: 'declaration',
          at: ['rejections', 'NOT_FOUND', 'status'],
          rule: 'code-status-conflict',
          message: 'A code has one HTTP status across the Contract: NOT_FOUND is 404 and 410',
        },
      ],
    });
  });

  test('a null body beside a bodiless declaration of one code fails once, as no schema', () => {
    const locked = defineRejection({ code: 'LOCKED', status: 423, message: 'Locked' });
    const lockedNull = defineRejection({
      code: 'LOCKED',
      status: 423,
      message: 'Locked',
      body: null as unknown as z.ZodString,
    });
    const endpoints = [
      defineEndpoint({ ...listing, rejections: [locked] }),
      defineEndpoint({ ...creating, rejections: [lockedNull] }),
    ] as const;

    expect(validateEndpoints(endpoints)).toEqual(
      failed(['rejections', 'LOCKED', 'body'], 'not-a-schema', 'body is not a zod schema'),
    );
  });

  test('a Guard’s Rejection disagreeing with an Endpoint’s on one code fails', () => {
    const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
    const forbiddenWithBody = defineRejection({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Forbidden',
      body: z.object({ missing: z.string() }),
    });
    const permission = defineGuard({
      name: 'permission',
      description: 'A permission',
      rejections: [forbidden],
    });
    const endpoint = defineEndpoint({
      ...listing,
      guards: [permission],
      rejections: [forbiddenWithBody],
    });

    expect(validateEndpoints([endpoint])).toEqual(
      failed(
        ['rejections', 'FORBIDDEN', 'body'],
        'code-body-conflict',
        'A code has one body schema across the Contract: FORBIDDEN',
      ),
    );
  });
});

describe('validateContract: reserved codes', () => {
  test.each(['RETIRED', 'NO_SUCH_ENDPOINT', 'BODY_TOO_LARGE', 'INVALID_OUTCOME'])(
    'a Rejection with the reserved code %s fails',
    (code) => {
      const reserved = defineRejection({ code, status: 410, message: 'Reserved' });

      expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [reserved] })])).toEqual(
        failed(
          ['rejections', code, 'code'],
          'reserved-code',
          `A code cf-loom answers as a Fault is reserved: ${code}`,
        ),
      );
    },
  );

  test('a Standard Rejection declared with a reserved code fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        notFound: { code: 'NO_SUCH_ENDPOINT', status: 404, message: 'Not found' },
      },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'code'],
        'reserved-code',
        'A code cf-loom answers as a Fault is reserved: NO_SUCH_ENDPOINT',
      ),
    );
  });
});

describe('validateContract: Standard Rejections', () => {
  test('an Endpoint listing notFound validates', () => {
    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [notFound] })]).kind).toBe(
      'valid',
    );
  });

  test('an Endpoint listing invalidInput fails', () => {
    const rejections: readonly Rejection[] = [invalidInput as unknown as Rejection];

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections })])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'rejections', 0],
        'standard-rejection-listed',
        'invalidInput is added to every Endpoint without listing it',
      ),
    );
  });

  test('an Endpoint listing notImplemented fails', () => {
    const rejections: readonly Rejection[] = [orderLocked, notImplemented as unknown as Rejection];

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections })])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders', 'rejections', 1],
        'standard-rejection-listed',
        'notImplemented is added to every Endpoint without listing it',
      ),
    );
  });

  test('a Guard listing a Standard Rejection fails', () => {
    const rejections: readonly Rejection[] = [notFound as unknown as Rejection];
    const tenant = defineGuard({ name: 'tenant', description: 'A tenant', rejections });

    expect(validateEndpoints([defineEndpoint({ ...listing, guards: [tenant] })])).toEqual(
      failed(
        ['guards', 'tenant', 'rejections', 0],
        'standard-rejection-on-guard',
        'A Guard lists declared Rejections only: notFound',
      ),
    );
  });

  test('a Rejection declared with a Standard Rejection’s resolved code fails', () => {
    const notFoundAgain = defineRejection({ code: 'NOT_FOUND', status: 404, message: 'Not found' });

    expect(
      validateEndpoints([defineEndpoint({ ...listing, rejections: [notFoundAgain] })]),
    ).toEqual(
      failed(
        ['rejections', 'NOT_FOUND', 'code'],
        'standard-code-redefined',
        'Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to: NOT_FOUND',
      ),
    );
  });

  test('the Standard codes are the ones the listed Definitions Package resolves', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
      },
    });
    const badRequest = defineRejection({ code: 'BAD_REQUEST', status: 400, message: 'Bad' });
    const notFoundAgain = defineRejection({ code: 'NOT_FOUND', status: 404, message: 'Not found' });
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [defineEndpoint({ ...listing, rejections: [badRequest, notFoundAgain] })],
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [orders],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['rejections', 'BAD_REQUEST', 'code'],
          rule: 'standard-code-redefined',
          message:
            'Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to: BAD_REQUEST',
        },
        {
          kind: 'declaration',
          at: ['rejections', 'NOT_FOUND', 'code'],
          rule: 'standard-code-redefined',
          message:
            'Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to: NOT_FOUND',
        },
      ],
    });
  });

  test('two Standard Rejections resolving to one code fail in a Definitions Package', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        invalidInput: { code: 'NOT_FOUND', status: 400, message: 'Bad' },
        notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'code'],
        'standard-codes-distinct',
        'Each Standard Rejection resolves to a code of its own: NOT_FOUND is invalidInput and notFound',
      ),
    );
  });

  test('two Standard Rejections resolving to one code fail in a Contract', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        notFound: { code: 'GONE', status: 404, message: 'Gone' },
        notImplemented: { code: 'GONE', status: 501, message: 'Later' },
      },
    });
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 'definitions', 'standardRejections', 'notImplemented', 'code'],
        'standard-codes-distinct',
        'Each Standard Rejection resolves to a code of its own: GONE is notFound and notImplemented',
      ),
    );
  });

  test('a Standard Rejection declared with the default code of another fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { invalidInput: { code: 'NOT_FOUND', status: 404, message: 'Missing' } },
    });

    expect(validateInPackage(definitions, noOrigin)).toEqual(
      failed(
        ['standardRejections', 'notFound', 'code'],
        'standard-codes-distinct',
        'Each Standard Rejection resolves to a code of its own: NOT_FOUND is invalidInput and notFound',
      ),
    );
  });

  test('a Rejection declared with a Standard code and the same status fails once, as a redefinition', () => {
    const missing = defineRejection({ code: 'NOT_FOUND', status: 404, message: 'Missing' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [missing] })])).toEqual(
      failed(
        ['rejections', 'NOT_FOUND', 'code'],
        'standard-code-redefined',
        `Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to: NOT_FOUND`,
      ),
    );
  });

  test('one listed Definitions Package may declare Standard Rejections', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('two listed Definitions Packages declaring Standard Rejections fail', () => {
    const first = defineDefinitions({
      name: 'first',
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const second = defineDefinitions({
      name: 'second',
      standardRejections: { notImplemented: { code: 'LATER', status: 501, message: 'Later' } },
    });
    const contract = defineContract({ name: 'orders-service', definitions: [first, second] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 'second', 'standardRejections'],
        'standard-rejections-once',
        'At most one listed Definitions Package declares Standard Rejections: first already does',
      ),
    );
  });
});
