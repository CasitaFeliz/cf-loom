import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  notFound,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
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
  description: 'A key per Caller',
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
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'orders-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const name = 'orders-service';
  const provided = providedEndpointsOf(name, endpoints);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
    exportedSnapshot,
  };
}

/** A Provider whose Definitions Package resolved its Standard Rejections to codes of its own. */
const orders = contractPackageOf(
  { editOrder, getOrder },
  providedStandardRejections({
    invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
    notFound: { code: 'MISSING', status: 404, message: 'Nothing here' },
    notImplemented: { code: 'NOT_YET', status: 501, message: 'Not yet' },
  }),
);

const ordersDependency = defineDependency({
  provider: orders,
  endpoints: [orders.endpoints.editOrder, orders.endpoints.getOrder],
});

const edit = {
  params: { orderId: 'o-1' },
  headers: { 'x-api-key': 'k' },
  body: { quantity: 2 },
};

function rejecting(status: number, rejection: Record<string, unknown>) {
  return client(ordersDependency, {
    baseUrl: 'http://orders.test',
    fetch: async () => Response.json({ rejection }, { status }),
  });
}

describe('a Rejection', () => {
  test('a declared code arrives with its body read by its Reader schema', async () => {
    const body = { lockedAt: '2026-10-18T10:00:00Z', addedLater: 1 };
    const orders = rejecting(409, { code: 'ORDER_LOCKED', message: 'Locked', body });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });
  });

  test('a known Rejection carries the status it arrived with', async () => {
    const orders = rejecting(418, {
      code: 'ORDER_LOCKED',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toMatchObject({ kind: 'rejection', code: 'ORDER_LOCKED', status: 418 });
  });

  test('an unknown code arrives as unknown-rejection, with its code, status, message and body as received', async () => {
    const orders = rejecting(422, { code: 'CARD_EXPIRED', message: 'Expired', body: { at: 1 } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'unknown-rejection',
      source: 'provider',
      code: 'CARD_EXPIRED',
      status: 422,
      message: 'Expired',
      body: { at: 1 },
    });
  });

  test('an unknown code arrives with no body key when none was sent', async () => {
    const orders = rejecting(422, { code: 'CARD_EXPIRED', message: 'Expired' });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toStrictEqual({
      kind: 'unknown-rejection',
      source: 'provider',
      code: 'CARD_EXPIRED',
      status: 422,
      message: 'Expired',
    });
  });

  test('a code the Endpoint does not answer is unknown, even one the Provider declares', async () => {
    const orders = rejecting(409, {
      code: 'ORDER_LOCKED',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });

    const outcome = await orders.getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toMatchObject({ kind: 'unknown-rejection', code: 'ORDER_LOCKED' });
  });

  test('a known code whose body fails its Reader schema is INVALID_OUTCOME, committed unknown', async () => {
    const orders = rejecting(409, { code: 'ORDER_LOCKED', message: 'Locked', body: { at: 1 } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'invalid-outcome',
      status: 409,
      code: 'INVALID_OUTCOME',
      committed: 'unknown',
      retryable: false,
      message: 'The Outcome broke the Contract',
      issues: [{ part: 'body', path: ['lockedAt'], code: 'required', message: expect.any(String) }],
    });
  });

  test('a code that declares no body has no body key, whatever arrived', async () => {
    const orders = rejecting(401, { code: 'UNAUTHENTICATED', message: 'No', body: { why: 'x' } });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toStrictEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'No',
    });
  });
});

describe('telling a Rejection', () => {
  test('a code is told only as written, case included', async () => {
    const orders = rejecting(409, {
      code: 'order_locked',
      message: 'Locked',
      body: { lockedAt: '2026-10-18T10:00:00Z' },
    });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toMatchObject({ kind: 'unknown-rejection', code: 'order_locked' });
  });

  test('a body that is both a Rejection and a Fault Envelope is the Rejection', async () => {
    const both = {
      rejection: { code: 'UNAUTHENTICATED', message: 'No' },
      fault: { committed: 'no', retryable: true, message: 'Busy' },
    };
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => Response.json(both, { status: 401 }),
    });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toMatchObject({ kind: 'rejection', code: 'UNAUTHENTICATED' });
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
      { kind: 'rejection', code: 'MISSING' },
      { kind: 'rejection', code: 'NOT_YET' },
      { kind: 'unknown-rejection', code: 'NOT_FOUND' },
    ]);
    const [first] = outcomes;
    if (first?.kind === 'rejection') {
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
      { kind: 'rejection', code: 'BAD_REQUEST', body: { issues: [issue] } },
      { kind: 'fault', source: 'invalid-outcome', status: 400, code: 'INVALID_OUTCOME' },
    ]);
  });

  test('an issue code or part a later cf-loom adds arrives as its Unknown case', async () => {
    const issue = { in: 'cookies', path: [], code: 'too_deep', message: 'Too deep' };
    const orders = rejecting(400, {
      code: 'BAD_REQUEST',
      message: 'The request is invalid',
      body: { issues: [issue] },
    });

    const outcome = await orders.editOrder(edit);

    expect(outcome).toMatchObject({
      kind: 'rejection',
      code: 'BAD_REQUEST',
      body: { issues: [{ in: { unknown: 'cookies' }, code: { unknown: 'too_deep' } }] },
    });
  });
});
