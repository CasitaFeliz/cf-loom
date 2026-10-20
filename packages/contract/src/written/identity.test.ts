import { describe, expect, test } from 'vitest';
import { messageIdentityOf, nameAndVersionOf } from '../internal/index.ts';

describe('nameAndVersionOf', () => {
  test('a Message Version’s identity reads back to its name and version', () => {
    const identity = messageIdentityOf('OrderCreated', 12);

    const message = nameAndVersionOf(identity);

    expect(message).toEqual({ name: 'OrderCreated', version: 12 });
  });
});
