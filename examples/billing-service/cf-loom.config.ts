import { defineConfig } from '@cf-loom/cli';

export const config = defineConfig({
  layout: {
    endpoint: 'src/{group}/{name}.handler.ts',
    subscription: 'src/{group}/{name}.handler.ts',
    handlerMap: 'src/generated/handlers.generated.ts',
    readers: 'src/generated/readers.generated.ts',
  },
});
