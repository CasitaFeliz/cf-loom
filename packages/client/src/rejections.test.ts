import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  notFound,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { client } from './index.ts';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Who are you?',
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  rejections: [unauthenticated],
});

const editOrder = defineEndpoint({
  name: 'editOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Changes an order',
  guards: [apiKey],
  input: {
    params: z.object({ orderId: z.string() }),
    headers: z.object({ 'x-api-key': z.string() }),
    body: z.object({ quantity: z.int() }),
  },
  success: { status: 204 },
  rejections: [notFound, orderLocked],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends ContractPackage['endpoints'],
  const Standards extends StandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const { format, defs, guards, codes } = snapshot;
  const exportedSnapshot = { format, defs, endpoints: snapshot.endpoints, guards, codes };
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const defaultStandards = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

/** A Provider whose Definitions Package resolved its Standard Rejections to codes of its own. */
const orders = contractPackageOf({ editOrder, getOrder }, {
  invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
  notFound: { code: 'MISSING', status: 404, message: 'Nothing here' },
  notImplemented: { code: 'NOT_YET', status: 501, message: 'Not yet' },
} as const);

const ordersDeps = defineDependencies(orders, { endpoints: [editOrder, getOrder] });

const edit = {
  params: { orderId: 'o-1' },
  headers: { 'x-api-key': 'k' },
  body: { quantity: 2 },
};

function rejecting(status: number, rejection: Record<string, unknown>) {
  return client(ordersDeps, {
    baseUrl: 'http://orders.test',
    fetch: async () => Response.json({ rejection }, { status }),
  });
}

describe('a Rejection', () => {
  test('a declared code is known, with its body read by its Reader schema', async () => {
    const body = { lockedAt: '2026-10-18T10:00:00Z', addedLater: 1 };
    const orders = rejecting(409, { code: 'ORDER_LOCKED', message: 'Locked', body });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'rejection',
      known: true,
      code: 'ORDER_LOCKED',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });
  });

  test('checking known narrows by code to the declared body', async () => {
    const orders = rejecting(409, {
      code: 'ORDER_LOCKED',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });

    const outcome = await orders.editOrder(edit);

    if (outcome.kind === 'rejection' && outcome.known && outcome.code === 'ORDER_LOCKED') {
      expectTypeOf(outcome.body).toEqualTypeOf<{ lockedAt: string }>();
    }
    expect(outcome.kind).toBe('rejection');
  });

  test('an unknown code is known false, with its code and body as received', async () => {
    const orders = rejecting(422, { code: 'CARD_EXPIRED', message: 'Expired', body: { at: 1 } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'rejection',
      known: false,
      code: 'CARD_EXPIRED',
      message: 'Expired',
      body: { at: 1 },
    });
  });

  test('a code the Endpoint does not answer is known false, even one the Provider declares', async () => {
    const orders = rejecting(409, {
      code: 'ORDER_LOCKED',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });

    const outcome = await orders.getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toMatchObject({ kind: 'rejection', known: false, code: 'ORDER_LOCKED' });
  });

  test('a known code whose body fails its Reader schema is INVALID_OUTCOME, committed unknown', async () => {
    const orders = rejecting(409, { code: 'ORDER_LOCKED', message: 'Locked', body: { at: 1 } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'fault',
      code: 'INVALID_OUTCOME',
      committed: 'unknown',
      retryable: false,
      message: 'The Outcome broke the Contract',
      issues: [{ part: 'body', path: ['lockedAt'], code: 'required', message: expect.any(String) }],
    });
  });

  test('a body on a code that declares none is dropped', async () => {
    const orders = rejecting(401, { code: 'UNAUTHENTICATED', message: 'No', body: { why: 'x' } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'rejection',
      known: true,
      code: 'UNAUTHENTICATED',
      message: 'No',
      body: undefined,
    });
  });
});

describe('Standard Rejections', () => {
  test('are known by the Provider’s codes, as its Definitions Package resolved them', async () => {
    const missing = rejecting(404, { code: 'MISSING', message: 'Nothing here' });
    const notYet = rejecting(501, { code: 'NOT_YET', message: 'Not yet' });
    const ours = rejecting(404, { code: 'NOT_FOUND', message: 'Not found' });

    const outcomes = [
      await missing.editOrder(edit),
      await notYet.editOrder(edit),
      await ours.editOrder(edit),
    ];

    expect(outcomes).toMatchObject([
      { known: true, code: 'MISSING' },
      { known: true, code: 'NOT_YET' },
      { known: false, code: 'NOT_FOUND' },
    ]);
    const [first] = outcomes;
    if (first?.kind === 'rejection' && first.known) {
      expectTypeOf(first.code).toEqualTypeOf<
        'ORDER_LOCKED' | 'UNAUTHENTICATED' | 'MISSING' | 'BAD_REQUEST' | 'NOT_YET'
      >();
    }
  });

  test('the invalid-input body is read as cf-loom’s, and one that breaks it is INVALID_OUTCOME', async () => {
    const issue = { in: 'body', path: ['quantity'], code: 'invalid_type', message: 'A number' };
    const valid = rejecting(400, {
      code: 'BAD_REQUEST',
      message: 'The request is invalid',
      body: { issues: [issue] },
    });
    const broken = rejecting(400, {
      code: 'BAD_REQUEST',
      message: 'The request is invalid',
      body: { problems: [] },
    });

    const outcomes = [await valid.editOrder(edit), await broken.editOrder(edit)];

    expect(outcomes).toMatchObject([
      { kind: 'rejection', known: true, code: 'BAD_REQUEST', body: { issues: [issue] } },
      { kind: 'fault', code: 'INVALID_OUTCOME', committed: 'unknown' },
    ]);
  });

  test('an issue code or part a later cf-loom adds arrives as its Unknown case', async () => {
    const issue = { in: 'cookies', path: [], code: 'too_late', message: 'Too late' };
    const orders = rejecting(400, {
      code: 'BAD_REQUEST',
      message: 'The request is invalid',
      body: { issues: [issue] },
    });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toMatchObject({
      known: true,
      code: 'BAD_REQUEST',
      body: { issues: [{ in: { unknown: 'cookies' }, code: { unknown: 'too_late' } }] },
    });
  });
});
