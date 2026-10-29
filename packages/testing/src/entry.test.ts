import { expect, test } from 'vitest';

test('the entry exports fakeProvider and FakeProviderError alone, as the README lists them', async () => {
  const entry = await import('./index.ts');

  const exported = Object.keys(entry).sort();

  expect(exported).toEqual(['FakeProviderError', 'fakeProvider']);
});
