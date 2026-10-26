import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  invalidInput,
  notFound,
  notImplemented,
  type Rejection,
  type RejectionStatus,
} from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

function validateEndpoints(endpoints: readonly [Endpoint, ...Endpoint[]]) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints });
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
}

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

const endpointAt = 'endpoints.GET /orders (listOrders)';

describe('validateRoot: Rejection statuses', () => {
  test('a Rejection with a 4xx status validates', () => {
    const endpoint = defineEndpoint({ ...listing, rejections: [orderLocked] });

    expect(validateEndpoints([endpoint]).kind).toBe('valid');
  });

  test('a Rejection with a status outside 4xx fails', () => {
    const status = 500 as RejectionStatus;
    const failing = defineRejection({ code: 'UPSTREAM_DOWN', status, message: 'Down' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [failing] })])).toEqual(
      failed('codes.UPSTREAM_DOWN status', 'rejection-status', "A Rejection's status is 4xx: 500"),
    );
  });

  test('a Rejection status written as a string is quoted in the message', () => {
    const status = '409' as unknown as RejectionStatus;
    const failing = defineRejection({ code: 'ORDER_LOCKED', status, message: 'Locked' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [failing] })])).toEqual(
      failed('codes.ORDER_LOCKED status', 'rejection-status', `A Rejection's status is 4xx: "409"`),
    );
  });

  test('a Standard Rejection a Definitions Package declares with a status outside 4xx fails', () => {
    const status = 200 as RejectionStatus;
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'NOT_FOUND', status, message: 'Not found' } },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.notFound status',
        'rejection-status',
        "A Rejection's status is 4xx: 200",
      ),
    );
  });

  test('the not-implemented Rejection with a status other than 501 fails', () => {
    const status = 500 as 501;
    const definitions = defineDefinitions({
      standardRejections: { notImplemented: { code: 'NOT_IMPLEMENTED', status, message: 'Later' } },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.notImplemented status',
        'rejection-status',
        "The not-implemented Rejection's status is 501: 500",
      ),
    );
  });
});

describe('validateRoot: an Endpoint or a Guard lists each Rejection once', () => {
  test('an Endpoint listing one Rejection twice fails at the second listing, naming the code', () => {
    const rejections: readonly Rejection[] = [
      orderLocked,
      notFound as unknown as Rejection,
      orderLocked,
    ];

    const validated = validateEndpoints([defineEndpoint({ ...listing, rejections })]);

    expect(validated).toEqual(
      failed(`${endpointAt} rejections[2]`, 'rejection-once', 'ORDER_LOCKED is listed twice'),
    );
  });

  test('an Endpoint listing two Rejections with one code fails at the second listing', () => {
    const lockedAgain = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: z.object({ lockedAt: z.iso.datetime() }),
    });
    const rejections: readonly Rejection[] = [orderLocked, lockedAgain];

    const validated = validateEndpoints([defineEndpoint({ ...listing, rejections })]);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: `${endpointAt} rejections[1]`,
          rule: 'rejection-once',
          message: 'ORDER_LOCKED is listed twice',
        },
        {
          kind: 'declaration',
          location: 'codes.ORDER_LOCKED',
          rule: 'code-once',
          message: 'A code is declared once: ORDER_LOCKED (the Contract, twice)',
        },
      ],
    });
  });

  test('an Endpoint listing notFound twice fails at the second listing, naming it', () => {
    const rejections: readonly Rejection[] = [
      notFound,
      notFound,
    ] as unknown as readonly Rejection[];

    const validated = validateEndpoints([defineEndpoint({ ...listing, rejections })]);

    expect(validated).toEqual(
      failed(`${endpointAt} rejections[1]`, 'rejection-once', 'notFound is listed twice'),
    );
  });

  test('a Guard listing one Rejection twice fails at the second listing, naming the code', () => {
    const rejections: readonly Rejection[] = [orderLocked, orderLocked];
    const tenant = defineGuard({ name: 'tenant', description: 'A tenant', rejections });

    const validated = validateEndpoints([defineEndpoint({ ...listing, guards: [tenant] })]);

    expect(validated).toEqual(
      failed('guards.tenant rejections[1]', 'rejection-once', 'ORDER_LOCKED is listed twice'),
    );
  });

  test('an Endpoint and its Guard listing one Rejection each validates', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      rejections: [orderLocked],
    });
    const endpoint = defineEndpoint({ ...listing, guards: [tenant], rejections: [orderLocked] });

    expect(validateEndpoints([endpoint]).kind).toBe('valid');
  });
});

describe('validateRoot: reserved codes', () => {
  test.each([
    'RETIRED',
    'NO_SUCH_ENDPOINT',
    'METHOD_NOT_ALLOWED',
    'BODY_TOO_LARGE',
    'INVALID_OUTCOME',
  ])('a Rejection with the reserved code %s fails', (code) => {
    const reserved = defineRejection({ code, status: 410, message: 'Reserved' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [reserved] })])).toEqual(
      failed(
        `codes.${code} code`,
        'reserved-code',
        `A code cf-loom answers as a Fault is reserved: "${code}"`,
      ),
    );
  });

  test('a Standard Rejection declared with a reserved code fails', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        notFound: { code: 'NO_SUCH_ENDPOINT', status: 404, message: 'Not found' },
      },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.notFound code',
        'reserved-code',
        'A code cf-loom answers as a Fault is reserved: "NO_SUCH_ENDPOINT"',
      ),
    );
  });
});

describe('validateRoot: Standard Rejections', () => {
  test('an Endpoint listing notFound validates', () => {
    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [notFound] })]).kind).toBe(
      'valid',
    );
  });

  test('an Endpoint listing invalidInput fails', () => {
    const rejections: readonly Rejection[] = [invalidInput as unknown as Rejection];

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections })])).toEqual(
      failed(
        `${endpointAt} rejections[0]`,
        'standard-rejection-listed',
        'invalidInput is added to every Endpoint without listing it',
      ),
    );
  });

  test('an Endpoint listing notImplemented fails', () => {
    const rejections: readonly Rejection[] = [orderLocked, notImplemented as unknown as Rejection];

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections })])).toEqual(
      failed(
        `${endpointAt} rejections[1]`,
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
        'guards.tenant rejections[0]',
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
        'codes.NOT_FOUND',
        'code-once',
        'A code is declared once: NOT_FOUND (the Contract and the notFound Standard Rejection)',
      ),
    );
  });

  test('the Standard codes are the ones the standardRejections package resolves', () => {
    const definitions = defineDefinitions({
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
    const contract = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [orders],
    });

    expect(validateInPackage(contract)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'codes.BAD_REQUEST',
          rule: 'code-once',
          message:
            'A code is declared once: BAD_REQUEST (the Contract and the invalidInput Standard Rejection)',
        },
        {
          kind: 'declaration',
          location: 'codes.NOT_FOUND',
          rule: 'code-once',
          message:
            'A code is declared once: NOT_FOUND (the Contract and the notFound Standard Rejection)',
        },
      ],
    });
  });

  test('two Standard Rejections resolving to one code fail in a Definitions Package', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        invalidInput: { code: 'NOT_FOUND', status: 400, message: 'Bad' },
        notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.invalidInput',
        'code-once',
        'A code is declared once: NOT_FOUND (the invalidInput Standard Rejection and the notFound Standard Rejection)',
      ),
    );
  });

  test('two Standard Rejections resolving to one code fail in a Contract', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        notFound: { code: 'GONE', status: 404, message: 'Gone' },
        notImplemented: { code: 'GONE', status: 501, message: 'Later' },
      },
    });
    const contract = defineService({ name: 'orders-service', standardRejections: definitions });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'standardRejections.notFound',
        'code-once',
        'A code is declared once: GONE (the notFound Standard Rejection and the notImplemented Standard Rejection)',
      ),
    );
  });

  test('a Standard Rejection declared with the default code of another fails', () => {
    const definitions = defineDefinitions({
      standardRejections: { invalidInput: { code: 'NOT_FOUND', status: 404, message: 'Missing' } },
    });

    expect(validateInPackage(definitions)).toEqual(
      failed(
        'standardRejections.invalidInput',
        'code-once',
        'A code is declared once: NOT_FOUND (the invalidInput Standard Rejection and the notFound Standard Rejection)',
      ),
    );
  });

  test('a Rejection declared with a Standard code and the same status fails once', () => {
    const missing = defineRejection({ code: 'NOT_FOUND', status: 404, message: 'Missing' });

    expect(validateEndpoints([defineEndpoint({ ...listing, rejections: [missing] })])).toEqual(
      failed(
        'codes.NOT_FOUND',
        'code-once',
        'A code is declared once: NOT_FOUND (the Contract and the notFound Standard Rejection)',
      ),
    );
  });

  test('the Definitions Package a Contract names as standardRejections may declare them', () => {
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineService({ name: 'orders-service', standardRejections: definitions });

    expect(validateInPackage(contract).kind).toBe('valid');
  });
});
