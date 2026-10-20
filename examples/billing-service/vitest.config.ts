import { defineProject } from 'vitest/config';

/** Each test file gets its own modules, so the cached orders client gives each its own URL. */
export default defineProject({
  test: { name: '@org/billing-service', isolate: true },
});
