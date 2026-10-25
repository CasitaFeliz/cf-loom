import { describe, expect, test } from 'vitest';
import { codeNameOf } from '../internal/index.ts';

describe('codeNameOf', () => {
  test('a Message Version’s name in code lower-cases its first letter and appends V and its version', () => {
    const message = { name: 'OrderCreated', version: 12 };

    const name = codeNameOf(message);

    expect(name).toBe('orderCreatedV12');
  });
});
