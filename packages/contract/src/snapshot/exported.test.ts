import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineContract, defineEndpoint, defineGroup, defineGuard } from '../index.ts';
import {
  type EndpointSnapshot,
  exportedEntryOf,
  snapshotOf,
  textPartNodesOf,
  validateContract,
} from '../internal/index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

const getOrder = defineEndpoint({
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

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.string()) },
});

function exportedSnapshotOf() {
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error('The fixture is invalid');
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const { format, defs, endpoints, guards, codes } = snapshot;
  return { format, defs, endpoints, guards, codes };
}

const providing = { provider: 'orders-service', exportedSnapshot: exportedSnapshotOf() };

function entryOf(): EndpointSnapshot {
  return exportedEntryOf(providing, getOrder);
}

describe('exportedEntryOf', () => {
  test('an exported Endpoint is found by its identity', () => {
    const entry = entryOf();

    expect(entry.name).toBe('getOrder');
  });

  test('an Endpoint the exported Snapshot lacks is a bug, named with its Provider', () => {
    const find = () => exportedEntryOf(providing, listOrders);

    expect(find).toThrow('The exported Snapshot of orders-service has no GET /orders');
  });
});

describe('textPartNodesOf', () => {
  test('the text parts of an entry are its Input’s, its Guards’ demands merged in', () => {
    const nodes = textPartNodesOf(entryOf());

    expect(Object.keys(nodes)).toEqual(['input.params', 'input.query', 'input.headers']);
    expect(Object.keys(nodes['input.headers']?.fields ?? {})).toEqual(['x-api-key']);
  });

  test('a part the Endpoint takes nothing in has no node', () => {
    const entry = { ...entryOf(), input: { params: null, query: null, headers: null, body: null } };

    const nodes = textPartNodesOf(entry);

    expect(nodes).toEqual({});
  });
});
