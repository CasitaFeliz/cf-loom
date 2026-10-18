import { describe, expect, test } from 'vitest';
import type { ContractDirectory } from './directories/index.ts';
import { type ApprovalSource, defineConfig } from './index.ts';

/** A Contract directory as the README's example builds one, standing in for `github()`. */
function github(_options: { readonly org: string }): ContractDirectory {
  return { list: async () => ({ kind: 'listed', packages: [] }) };
}

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
      registry: 'https://npm.internal.example',
      directory: github({ org: 'org' }),
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
});
