import { describe, expect, test } from 'vitest';
import { exportedOrders, getOrder, listOrders } from '../../test/orders-exported.ts';
import { exportedEntryOf, textPartNodesOf } from '../internal/index.ts';

const exported = exportedOrders();

function entryOf() {
  return exportedEntryOf('orders-service', exported, getOrder);
}

describe('exportedEntryOf', () => {
  test('an exported Endpoint is found by its identity', () => {
    const entry = entryOf();

    expect(entry.name).toBe('getOrder');
  });

  test('an Endpoint the exported Snapshot lacks is a bug, named with its Provider', () => {
    const find = () => exportedEntryOf('orders-service', exported, listOrders);

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
