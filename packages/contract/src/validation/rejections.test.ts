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
import { validateContract } from '../internal/index.ts';

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
  return validateContract(defineContract({ name: 'orders-service', groups: [orders] }), noOrigin);
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

    expect(validateContract(definitions, noOrigin)).toEqual(
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

    expect(validateContract(definitions, noOrigin)).toEqual(
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
          rule: 'code-conflict',
          message: 'A code has one HTTP status across the Contract: ORDER_LOCKED is 409 and 423',
        },
        {
          kind: 'declaration',
          at: ['rejections', 'ORDER_LOCKED', 'body'],
          rule: 'code-conflict',
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
        'code-conflict',
        'A code has one body schema across the Contract: ORDER_LOCKED',
      ),
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
        'code-conflict',
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

    expect(validateContract(definitions, noOrigin)).toEqual(
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
        ['groups', 'orders', 'endpoints', 'listOrders', 'rejections', 0],
        'standard-rejection',
        'invalidInput is added to every Endpoint without listing it',
      ),
    );
  });

  test('an Endpoint listing notImplemented fails', () => {
    const rejections: readonly Rejection[] = [orderLocked, notImplemented as unknown as Rejection];

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections })])).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'listOrders', 'rejections', 1],
        'standard-rejection',
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
        'standard-rejection',
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
        'standard-rejection',
        'No Contract redefines a Standard Rejection: NOT_FOUND',
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

    expect(validateContract(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['rejections', 'BAD_REQUEST', 'code'],
          rule: 'standard-rejection',
          message: 'No Contract redefines a Standard Rejection: BAD_REQUEST',
        },
        {
          kind: 'declaration',
          at: ['rejections', 'NOT_FOUND', 'code'],
          rule: 'standard-rejection',
          message: 'No Contract redefines a Standard Rejection: NOT_FOUND',
        },
      ],
    });
  });

  test('one listed Definitions Package may declare Standard Rejections', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    expect(validateContract(contract, noOrigin).kind).toBe('valid');
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

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['definitions', 'second', 'standardRejections'],
        'standard-rejections-once',
        'At most one listed Definitions Package declares Standard Rejections: first already does',
      ),
    );
  });
});
