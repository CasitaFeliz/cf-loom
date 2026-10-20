import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  notFound,
} from '../index.ts';
import {
  type EndpointSnapshot,
  type GuardSnapshot,
  ownRejectionsOf,
  type ServiceSnapshot,
  snapshotOf,
  validateContract,
} from '../internal/index.ts';

const unauthenticated = defineRejection({ code: 'UNAUTHENTICATED', status: 401, message: 'No' });
const orderLocked = defineRejection({ code: 'ORDER_LOCKED', status: 409, message: 'Locked' });

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  rejections: [unauthenticated],
});

const updateOrder = defineEndpoint({
  name: 'updateOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Notes on an order',
  guards: [userToken],
  input: { params: z.object({ orderId: z.string() }), body: z.object({ note: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [orderLocked, notFound],
});

function declaredSnapshot(): ServiceSnapshot {
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [updateOrder] });
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
  return snapshot;
}

function aGuardEntry(fields: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    origin: 'orders-service',
    description: 'A Guard',
    guards: [],
    qualifier: null,
    demands: { headers: null, query: null },
    context: null,
    rejections: [],
    ...fields,
  };
}

describe('ownRejectionsOf', () => {
  test('an Endpoint’s own Rejections leave out its Guards’ codes and the two the runtime adds, notFound as the Standard one', () => {
    const snapshot = declaredSnapshot();
    const entry = snapshot.endpoints['PUT /orders/{}'] as EndpointSnapshot;

    const own = ownRejectionsOf(entry, snapshot);

    expect(own).toEqual([{ kind: 'not-found' }, { kind: 'declared', code: 'ORDER_LOCKED' }]);
  });

  test('a code a Guard reaches through the Guards it lists is no Rejection of the Endpoint’s own', () => {
    const snapshot = declaredSnapshot();
    const entry = snapshot.endpoints['PUT /orders/{}'] as EndpointSnapshot;
    const attached = { ...entry, guards: [{ guard: 'session', qualifier: null }] };
    const guards = {
      session: aGuardEntry({ guards: ['userToken'] }),
      userToken: aGuardEntry({ rejections: ['UNAUTHENTICATED'] }),
    };

    const own = ownRejectionsOf(attached, { ...snapshot, guards });

    expect(own).toEqual([{ kind: 'not-found' }, { kind: 'declared', code: 'ORDER_LOCKED' }]);
  });
});
