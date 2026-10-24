import { describe, expect, test } from 'vitest';
import { defineConfig } from './index.ts';

describe('defineConfig', () => {
  test('defineConfig returns the configuration it is given', () => {
    const config = { scope: '@org' };

    const defined = defineConfig(config);

    expect(defined).toEqual({ scope: '@org' });
  });

  test('defineConfig returns a configuration with a layout as it is given', () => {
    const layout = { endpoint: 'src/billing/{name}.handler.ts' } as const;

    const defined = defineConfig({ scope: '@org', layout });

    expect(defined).toEqual({
      scope: '@org',
      layout: { endpoint: 'src/billing/{name}.handler.ts' },
    });
  });

  test('a configuration declaring every layout field type-checks', () => {
    const defined = defineConfig({
      scope: '@org',
      layout: {
        endpoint: 'src/billing/{name}.handler.ts',
        guard: 'src/guards/{name}.handler.ts',
        command: 'src/commands/{name}.v{version}.handler.ts',
        subscription: 'src/billing/{name}.handler.ts',
        handlerMap: 'src/generated/handlers.generated.ts',
        readers: 'src/generated/readers.generated.ts',
      },
    });

    expect(Object.keys(defined.layout ?? {})).toEqual([
      'endpoint',
      'guard',
      'command',
      'subscription',
      'handlerMap',
      'readers',
    ]);
  });

  test('a Handler path that does not end with .handler.ts is a type error', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: a Handler's file ends with `.handler.ts`
      layout: { guard: 'src/guards/{name}.ts' },
    });

    expect(defined.scope).toBe('@org');
  });

  test('a Handler path outside src/ is a type error', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: a Handler's file sits under `src/`
      layout: { guard: 'lib/guards/{name}.handler.ts' },
    });

    expect(defined.scope).toBe('@org');
  });

  test('a generated file’s path that does not end with .generated.ts is a type error', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: a generated file ends with `.generated.ts`
      layout: { readers: 'src/readers.ts' },
    });

    expect(defined.scope).toBe('@org');
  });

  test('a field the layout does not declare is a type error', () => {
    const defined = defineConfig({
      scope: '@org',
      // @ts-expect-error: `endpoints` is not a field of the layout
      layout: { endpoints: 'src/{name}.handler.ts' },
    });

    expect(defined.scope).toBe('@org');
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
