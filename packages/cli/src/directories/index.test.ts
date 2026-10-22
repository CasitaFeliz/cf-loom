import { describe, expect, test } from 'vitest';
import { type ContractDirectory, fixed } from './index.ts';

describe('fixed', () => {
  test('a fixed directory lists the names it was given', async () => {
    const directory = fixed(['@org/contract-orders-service', '@org/contract-billing-service']);

    const listed = await directory.list();

    expect(listed).toEqual({
      kind: 'listed',
      names: ['@org/contract-orders-service', '@org/contract-billing-service'],
    });
  });

  test('a fixed directory of no names lists an empty scope, not a failure', async () => {
    const directory = fixed([]);

    const listed = await directory.list();

    expect(listed).toEqual({ kind: 'listed', names: [] });
  });

  test('changing the array after fixed was called does not change what it lists', async () => {
    const names = ['@org/contract-orders-service'];
    const directory = fixed(names);

    names.push('@org/contract-billing-service');
    const listed = await directory.list();

    expect(listed).toEqual({ kind: 'listed', names: ['@org/contract-orders-service'] });
  });
});

describe('ContractDirectory', () => {
  test('an organization writes a directory whose list resolves to names or to a failure', async () => {
    const lists: ContractDirectory = {
      list: async () => ({ kind: 'listed', names: ['@org/contract-orders-service'] }),
    };
    const fails: ContractDirectory = {
      list: async () => ({ kind: 'failed', message: 'GitHub answered 502 while listing @org' }),
    };

    const listed = await lists.list();
    const failed = await fails.list();

    expect(listed).toEqual({ kind: 'listed', names: ['@org/contract-orders-service'] });
    expect(failed).toEqual({ kind: 'failed', message: 'GitHub answered 502 while listing @org' });
  });

  test('a listing that is neither listed nor failed, such as a partial one, is a type error', async () => {
    const partial: ContractDirectory = {
      // @ts-expect-error: a directory returns the whole list or fails, so it has no partial listing
      list: async () => ({ kind: 'partial', names: ['@org/contract-orders-service'] }),
    };

    const listed = await partial.list();

    expect(listed.kind).toBe('partial');
  });
});
