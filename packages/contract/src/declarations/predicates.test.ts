import { describe, expect, test } from 'vitest';
import { defineApplication, defineDefinitions, defineService } from '../index.ts';
import { isRoot, isServiceContract } from '../internal/index.ts';

describe('isServiceContract', () => {
  test('a Service’s Contract is one', () => {
    const service = defineService({ name: 'orders-service' });

    expect(isServiceContract(service)).toBe(true);
  });

  test('an Application’s Contract and a Definitions Package are not', () => {
    const application = defineApplication({ name: 'web-admin' });
    const definitions = defineDefinitions({});

    expect(isServiceContract(application)).toBe(false);
    expect(isServiceContract(definitions)).toBe(false);
  });

  test('an object that only looks like a Service’s Contract is not one', () => {
    expect(isServiceContract({ kind: 'service', name: 'orders-service' })).toBe(false);
  });
});

describe('isRoot', () => {
  test('a Service’s Contract, an Application’s and a Definitions Package are Roots', () => {
    const roots = [
      defineService({ name: 'orders-service' }),
      defineApplication({ name: 'web-admin' }),
      defineDefinitions({}),
    ];

    expect(roots.map(isRoot)).toEqual([true, true, true]);
  });

  test('a value that no define function returned is not a Root', () => {
    expect(isRoot(null)).toBe(false);
    expect(isRoot({ kind: 'service', name: 'orders-service' })).toBe(false);
  });
});
