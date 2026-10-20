import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, defineGuard } from '../index.ts';
import { demandIssuesOf } from '../internal/index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().min(4) }) },
});

const tenant = defineGuard({
  name: 'tenant',
  description: 'The tenant a request acts for',
  demands: { query: z.object({ tenant: z.string() }) },
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'The latest order',
  guards: [apiKey, tenant],
  success: { status: 204 },
});

describe('demandIssuesOf', () => {
  test('demands every Guard admits give no Issue', () => {
    const given = { headers: { 'x-api-key': 'abcd' }, query: { tenant: 't' } };

    const issues = demandIssuesOf(getOrder, given);

    expect(issues).toEqual([]);
  });

  test('the first Guard whose demands fail answers alone, in Attachment order', () => {
    const given = { headers: { 'x-api-key': 'ab' }, query: {} };

    const issues = demandIssuesOf(getOrder, given);

    expect(issues).toEqual([
      {
        part: 'demands.headers',
        path: ['x-api-key'],
        code: 'too_small',
        message: expect.any(String),
      },
    ]);
  });

  test('a later Guard’s demands are read once the earlier ones are met', () => {
    const given = { headers: { 'x-api-key': 'abcd' }, query: {} };

    const issues = demandIssuesOf(getOrder, given);

    expect(issues).toMatchObject([{ part: 'demands.query', path: ['tenant'], code: 'required' }]);
  });
});
