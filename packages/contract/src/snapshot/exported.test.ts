import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineGroup, defineGuard, defineService } from '../index.ts';
import {
  checkExportedFormat,
  type EndpointSnapshot,
  type ExportedSnapshot,
  exportedEntryOf,
  exportedSnapshotOf,
  snapshotOf,
  textPartNodesOf,
  validateRoot,
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

function declaredSnapshotOf() {
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'orders-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error('The fixture is invalid');
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

const providing = {
  name: 'orders-service',
  exportedSnapshot: exportedSnapshotOf(declaredSnapshotOf()),
};

function withFormat(format: unknown): typeof providing {
  const { format: _written, ...rest } = providing.exportedSnapshot;
  const exportedSnapshot = format === undefined ? rest : { ...rest, format };
  return { ...providing, exportedSnapshot: exportedSnapshot as ExportedSnapshot };
}

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

  test('the parts the Endpoint takes nothing in are nodes with no field, except its params', () => {
    const noFields = { type: 'object', fields: {} } as const;
    const entry = {
      ...entryOf(),
      input: { params: null, query: noFields, headers: noFields, body: null },
    };

    const nodes = textPartNodesOf(entry);

    expect(nodes).toEqual({ 'input.query': noFields, 'input.headers': noFields });
  });
});

describe('checkExportedFormat', () => {
  test('an exported Snapshot in a format this cf-loom reads is accepted', () => {
    const check = () => checkExportedFormat(providing);

    expect(check).not.toThrow();
  });

  test.each([2, 99])(
    'an exported Snapshot in format %i, newer than this cf-loom reads, is refused',
    (format) => {
      const check = () => checkExportedFormat(withFormat(format));

      expect(check).toThrow(
        `orders-service's exported Snapshot is in format ${format}, newer than this cf-loom reads: upgrade the @cf-loom packages`,
      );
    },
  );

  test.each([
    { given: 'a text', format: '1' },
    { given: 'none', format: undefined },
  ])('an exported Snapshot whose format is $given is refused as malformed', ({ format }) => {
    const check = () => checkExportedFormat(withFormat(format));

    expect(check).toThrow(
      "orders-service's exported Snapshot is malformed: format is not a whole number from 1",
    );
  });
});
