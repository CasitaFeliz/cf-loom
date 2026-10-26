import { z } from 'zod';
import {
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineService,
} from '../src/index.ts';
import {
  type ExportedSnapshot,
  exportedCutOf,
  type ServiceSnapshot,
  snapshotOf,
  validateRoot,
} from '../src/internal/index.ts';
import { aRootPackage } from './root-package.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

/** A Public Endpoint behind a Guard, with a path param and a query param. */
export const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  guards: [apiKey],
  input: {
    params: z.object({ orderId: z.string() }),
    query: z.object({ fields: z.array(z.string()).optional() }),
  },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

/** A Public Endpoint a test leaves out of the Service, so its exported Snapshot has no entry for it. */
export const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.string()) },
});

/** A Deprecated Endpoint, which its cut keeps with its instant. */
export const oldOrder = defineEndpoint({
  name: 'oldOrder',
  method: 'GET',
  path: '/old-orders/:orderId',
  visibility: 'internal',
  description: 'One order, the old way',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-11-01T00:00:00Z',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

/** An Internal Event, which the exported Snapshot keeps with its body. */
export const orderPlaced = defineEvent({
  name: 'OrderPlaced',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.string() }),
});

/** The declared Snapshot of `orders-service`: `getOrder`, `oldOrder` and `OrderPlaced@1`. */
export function ordersSnapshot(): ServiceSnapshot {
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [getOrder, oldOrder],
    events: [orderPlaced],
  });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const validated = validateRoot(root, aRootPackage(root, { packageName: 'orders-service' }));
  if (validated.kind !== 'valid') {
    throw new Error('The fixture is invalid');
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

/** The exported Snapshot of `orders-service` cut to `getOrder`. */
export function exportedOrders(): ExportedSnapshot {
  return exportedCutOf(ordersSnapshot(), 'GET /orders/{}');
}
