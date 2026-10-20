import { describe, expect, test } from 'vitest';
import { defineContract, defineDefinitions } from '../index.ts';
import { standardRejectionsOf } from '../internal/index.ts';

describe('standardRejectionsOf', () => {
  test('a listed Definitions Package’s declarations take the place of cf-loom’s defaults', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      standardRejections: {
        invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
      },
    });
    const contract = defineContract({ name: 'orders-service', definitions: [definitions] });

    const standards = standardRejectionsOf(contract);

    expect(standards).toEqual({
      invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    });
  });

  test('a root listing no Definitions Package resolves to cf-loom’s defaults', () => {
    const contract = defineContract({ name: 'orders-service' });

    const standards = standardRejectionsOf(contract);

    expect(standards).toEqual({
      invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
    });
  });
});
