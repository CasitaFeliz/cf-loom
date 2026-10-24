import { defineConfig } from '@cf-loom/cli';

export const config = defineConfig({
  scope: '@org',
  layout: {
    endpoint: 'src/billing/{name}.handler.ts',
    subscription: 'src/billing/{name}.handler.ts',
    handlerMap: 'src/generated/handlers.generated.ts',
    readers: 'src/generated/readers.generated.ts',
  },
});
