import { defineDefinitions } from '@cf-loom/contract';
import { apiKey } from './guards/api-key.guard.ts';
import { unauthenticated } from './rejections/unauthenticated.rejection.ts';
import { money } from './schemas/money.schema.ts';

export const definitions = defineDefinitions({
  name: 'definitions',
  guards: [apiKey],
  schemas: { money },
  rejections: [unauthenticated],
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
    notFound: { code: 'RESOURCE_NOT_FOUND', status: 404, message: 'The resource does not exist' },
    notImplemented: { code: 'NOT_YET_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
});

export { apiKey, money, unauthenticated };
