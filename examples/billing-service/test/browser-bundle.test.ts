import { join } from 'node:path';
import { build, type Rolldown } from 'vite';
import { describe, expect, test } from 'vitest';

/** The browser bundle of `browser/app.ts`, as Vite builds a library from it, unminified so names can be read. */
async function bundledApp(): Promise<string> {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    root: import.meta.dirname,
    build: {
      lib: { entry: join(import.meta.dirname, 'browser/app.ts'), formats: ['es'] },
      minify: false,
      write: false,
    },
  });
  const [output] = Array.isArray(built) ? built : [built];
  const { output: files } = output as Rolldown.RolldownOutput;
  return files.map((file) => (file.type === 'chunk' ? file.code : '')).join('\n');
}

describe('a browser bundle of an Application', () => {
  test('one listing only createOrder holds createOrder and no getOrder, OrderCreated, ORDER_LOCKED, GET /orders/{} entry or Internal Element', async () => {
    const bundle = await bundledApp();

    expect(bundle).toContain('createOrder');
    for (const unreached of [
      'getOrder',
      'OrderCreated',
      'ORDER_LOCKED',
      '"GET /orders/{}"',
      '"visibility": "internal"',
    ]) {
      expect(bundle).not.toContain(unreached);
    }
  });
});
