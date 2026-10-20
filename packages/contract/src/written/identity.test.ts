import { describe, expect, test } from 'vitest';
import { messageIdentityOf, messageVersionOf } from '../internal/index.ts';

describe('messageVersionOf', () => {
  test('a Message Version’s identity reads back to its name and version', () => {
    const identity = messageIdentityOf('OrderCreated', 12);

    const message = messageVersionOf(identity);

    expect(message).toEqual({ name: 'OrderCreated', version: 12 });
  });
});
