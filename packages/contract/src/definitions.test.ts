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

  test('a Definitions Package may declare its Standard Rejections’ codes, statuses and messages', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'Bad request' },
        notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
      },
    });

    expect(definitions.standardRejections.invalidInput.status).toBe(422);
  });

  test('notImplemented’s status must be 501', () => {
    const declare = () =>
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          // @ts-expect-error not implemented is always 501
          notImplemented: { code: 'NOT_IMPLEMENTED', status: 500, message: 'Not implemented' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('invalidInput’s status must be a 4xx', () => {
    const declare = () =>
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          // @ts-expect-error invalid input is a 4xx
          invalidInput: { code: 'BAD_REQUEST', status: 501, message: 'Bad request' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('a Standard Rejection declares no body', () => {
    const declare = () =>
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          notFound: {
            code: 'NOT_FOUND',
            status: 404,
            message: 'Not found',
            // @ts-expect-error cf-loom owns the Standard Rejections' bodies
            body: z.object({ resource: z.string() }),
          },
        },
      });

    expect(declare).not.toThrow();
  });
});

describe('defineDefinitions fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      // @ts-expect-error a Definitions Package owns no Endpoints
      defineDefinitions({ name: 'definitions', endpoints: [] });

    expect(declare).not.toThrow();
  });
});

describe('a declared Definitions Package’s containers', () => {
  test('a Definitions Package freezes its lists and maps and keeps its schemas', () => {
    const money = z.object({ amount: z.int() });
    const schemas = { money };
    const notFound = { code: 'NOT_FOUND', status: 404, message: 'Not found' } as const;

    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [],
      schemas,
      rejections: [],
      standardRejections: { notFound },
    });
    Reflect.set(schemas, 'money', z.object({}));

    expect(definitions.schemas.money).toBe(money);
    expect(Object.isFrozen(definitions.schemas)).toBe(true);
    expect(Object.isFrozen(definitions.guards)).toBe(true);
    expect(Object.isFrozen(definitions.rejections)).toBe(true);
    expect(Object.isFrozen(definitions.standardRejections)).toBe(true);
    expect(Object.isFrozen(definitions.standardRejections.notFound)).toBe(true);
  });
});

describe('defineDefinitions nested fields', () => {
  test('an undeclared Standard Rejection is a type error', () => {
    const declare = () =>
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'Bad request' },
          // @ts-expect-error notFund is not a Standard Rejection
          notFund: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
        },
      });

    expect(declare).not.toThrow();
  });

  test('an undeclared field in a Standard Rejection is a type error', () => {
    const declare = () =>
      defineDefinitions({
        name: 'definitions',
        standardRejections: {
          notFound: {
            code: 'NOT_FOUND',
            status: 404,
            message: 'Not found',
            // @ts-expect-error detail is not a field of a Standard Rejection
            detail: 'More',
          },
        },
      });

    expect(declare).not.toThrow();
  });
});
