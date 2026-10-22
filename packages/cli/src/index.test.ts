import { describe, expect, test } from 'vitest';
import { defineConfig } from './index.ts';

describe('defineConfig', () => {
  test('defineConfig returns the configuration it is given', () => {
    const config = { scope: '@org' };

    const defined = defineConfig(config);

    expect(defined).toEqual({ scope: '@org' });
  });

  test('the README’s configuration declares every documented field', () => {
    const written = { scope: '@org' } as const;

    const defined = defineConfig(written);

    expect(defined).toBe(written);
  });

  test('a field the configuration does not declare is a type error', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: `registries` is not a field of the configuration
      registries: ['https://npm.internal.example'],
    });

    expect(defined.scope).toBe('@org');
  });

  test('registry is not a field of the configuration', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: the registry is the organization's npm configuration
      registry: 'https://registry.npmjs.org',
    });

    expect(defined.scope).toBe('@org');
  });

  test('approvals, approvers and allowSelfApproval are not fields of the configuration', () => {
    const approvals = defineConfig({
      scope: '@org',
      // @ts-expect-error: the organization's review process enforces Approvals
      approvals: null,
    });
    const approvers = defineConfig({
      scope: '@org',
      // @ts-expect-error: the organization's review process decides who may approve
      approvers: ['@org/platform-team'],
    });
    const allowSelfApproval = defineConfig({
      scope: '@org',
      // @ts-expect-error: the organization's review process decides who may approve
      allowSelfApproval: false,
    });

    expect([approvals.scope, approvers.scope, allowSelfApproval.scope]).toEqual([
      '@org',
      '@org',
      '@org',
    ]);
  });
});
