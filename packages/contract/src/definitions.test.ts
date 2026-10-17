import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineDefinitions, defineGuard, defineRejection } from './index.ts';

describe('defineDefinitions', () => {
  test('a Definitions Package keeps its Guards, schemas and Rejections by identity', () => {
    const money = z.object({ amount: z.int(), currency: z.string() });
    const userToken = defineGuard({ name: 'userToken', description: 'A signed-in user' });
    const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [userToken],
      schemas: { money },
      rejections: [forbidden],
    });

    expect(definitions.schemas.money).toBe(money);
    expect(definitions.guards[0]).toBe(userToken);
    expect(definitions.rejections[0]).toBe(forbidden);
    expect(definitions.kind).toBe('definitions');
  });

  test('notImplemented’s status must be 501', () => {
    const declare = () => [
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          // @ts-expect-error not implemented is always 501
          notImplemented: { code: 'NOT_IMPLEMENTED', status: 500, message: 'Not implemented' },
        },
      }),
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          // @ts-expect-error invalid input is a 4xx
          invalidInput: { code: 'BAD_REQUEST', status: 501, message: 'Bad request' },
        },
      }),
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'Bad request' },
          notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
        },
      }),
    ];

    expect(declare).not.toThrow();
  });
});
