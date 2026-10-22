import { describe, expect, test } from 'vitest';
import { type ApprovalSource, defineConfig } from './index.ts';

const myApprovalSource: ApprovalSource = {
  approvalsOf: async () => [{ approver: '@org/platform-team' }],
};

describe('defineConfig', () => {
  test('defineConfig returns the configuration it is given', () => {
    const config = { scope: '@org' };

    const defined = defineConfig(config);

    expect(defined).toEqual({ scope: '@org' });
  });

  test('the README’s configuration declares every documented field', () => {
    const written = {
      scope: '@org',
      approvals: myApprovalSource,
      approvers: ['@org/platform-team'],
      allowSelfApproval: false,
    } as const;

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
});
