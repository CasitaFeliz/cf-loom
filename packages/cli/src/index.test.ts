import { describe, expect, test } from 'vitest';
import { defineConfig } from './index.ts';

describe('defineConfig', () => {
  test('scope is not a field of the configuration: package.json names every package', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 a package's name comes from its package.json
      scope: '@org',
    });

    expect(Object.keys(defined)).toEqual(['scope']);
  });

  test('a configuration given through a variable with a field it does not declare is a type error', () => {
    const config = { layout: {}, layot: {} };

    // @ts-expect-error TS2345 layot is not a declared field
    const defining = () => defineConfig(config);

    expect(defining).toBeTypeOf('function');
  });

  test('a layout given through a variable with a field it does not declare is a type error', () => {
    const layout = {
      handlerMap: 'src/handlers.generated.ts',
      handlerMapp: 'src/x.generated.ts',
    } as const;

    // @ts-expect-error TS2322 handlerMapp is not a declared field
    const defining = () => defineConfig({ layout });

    expect(defining).toBeTypeOf('function');
  });

  test('defineConfig returns the configuration it is given', () => {
    const config = {};

    const defined = defineConfig(config);

    expect(defined).toEqual({});
  });

  test('defineConfig returns a configuration with a layout as it is given', () => {
    const layout = { endpoint: 'src/billing/{name}.handler.ts' } as const;

    const defined = defineConfig({ layout });

    expect(defined).toEqual({ layout: { endpoint: 'src/billing/{name}.handler.ts' } });
  });

  test('a configuration declaring every layout field type-checks', () => {
    const defined = defineConfig({
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
      // @ts-expect-error TS2322 a Handler's file ends with `.handler.ts`
      layout: { guard: 'src/guards/{name}.ts' },
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('a Handler path outside src/ is a type error', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 a Handler's file sits under `src/`
      layout: { guard: 'lib/guards/{name}.handler.ts' },
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('a generated file’s path that does not end with .generated.ts is a type error', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 a generated file ends with `.generated.ts`
      layout: { readers: 'src/readers.ts' },
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('a field the layout does not declare is a type error', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 `endpoints` is not a field of the layout
      layout: { endpoints: 'src/{name}.handler.ts' },
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('a field the configuration does not declare is a type error', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 `registries` is not a field of the configuration
      registries: ['https://npm.internal.example'],
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('registry is not a field of the configuration', () => {
    const defined = defineConfig({
      // @ts-expect-error TS2322 the registry is the organization's npm configuration
      registry: 'https://registry.npmjs.org',
    });

    expect(Object.keys(defined)).toHaveLength(1);
  });

  test('approvals, approvers and allowSelfApproval are not fields of the configuration', () => {
    const approvals = defineConfig({
      // @ts-expect-error TS2322 the organization's review process enforces Approvals
      approvals: null,
    });
    const approvers = defineConfig({
      // @ts-expect-error TS2322 the organization's review process decides who may approve
      approvers: ['@org/platform-team'],
    });
    const allowSelfApproval = defineConfig({
      // @ts-expect-error TS2322 the organization's review process decides who may approve
      allowSelfApproval: false,
    });

    expect([approvals, approvers, allowSelfApproval].map(Object.keys)).toEqual([
      ['approvals'],
      ['approvers'],
      ['allowSelfApproval'],
    ]);
  });
});
