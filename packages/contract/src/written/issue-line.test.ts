import { describe, expect, test } from 'vitest';
import { issueLineOf } from '../internal/index.ts';

describe('issueLineOf', () => {
  test('an Issue is written after its source, its part and path joined by dots, its code and its message', () => {
    const issue = {
      part: 'body',
      path: ['orderId'],
      code: 'invalid_format',
      message: 'Invalid UUID',
    } as const;

    const line = issueLineOf('orders', issue);

    expect(line).toBe('orders: body.orderId invalid_format: Invalid UUID');
  });

  test('an Issue at the part itself is written with no path', () => {
    const issue = { part: 'body', path: [], code: 'required', message: 'Required' } as const;

    const line = issueLineOf('orders', issue);

    expect(line).toBe('orders: body required: Required');
  });
});
