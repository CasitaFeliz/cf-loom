import { describe, expect, expectTypeOf, test } from 'vitest';
import { type ContractDirectory, fixed, type Listed } from './index.ts';

/** The names of a listing, so a test compares the arrays two listings hold. */
function namesOf(listed: Listed): readonly string[] {
  return listed.kind === 'listed' ? listed.names : [];
}

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

  test('two listings of a fixed directory do not share an array', async () => {
    const directory = fixed(['@org/contract-orders-service']);

    const first = namesOf(await directory.list());
    const second = namesOf(await directory.list());

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe('ContractDirectory', () => {
  test('a listing is the names of the whole scope or a failure with its message', () => {
    expectTypeOf<Listed>().toEqualTypeOf<
      | { readonly kind: 'listed'; readonly names: readonly string[] }
      | { readonly kind: 'failed'; readonly message: string }
    >();
  });

  test('a directory an organization writes needs only list', () => {
    expectTypeOf<{ readonly list: () => Promise<Listed> }>().toExtend<ContractDirectory>();
  });

  test('a directory whose list can resolve to a partial listing is not a Contract directory', () => {
    type PartialDirectory = {
      readonly list: () => Promise<{ readonly kind: 'partial'; readonly names: readonly string[] }>;
    };

    expectTypeOf<PartialDirectory>().not.toExtend<ContractDirectory>();
  });
});
