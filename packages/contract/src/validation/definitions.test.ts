import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
} from '../index.ts';
import { type OriginOf, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: OriginOf) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return validateContract(root, { originOf, packageName: typeof name === 'string' ? name : '' });
}

function noOrigin() {
  return undefined;
}

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  rejections: [unauthenticated],
});
const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  rejections: [forbidden],
});

function failuresOf(root: unknown) {
  const validated = validateInPackage(root, noOrigin);
  return validated.kind === 'invalid' ? validated.failures : [];
}

describe('validateContract: a Definitions Package lists what its Guards reach', () => {
  test('a Definitions Package that lists every Guard and Rejection its Guards reach is valid', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [userToken, permission],
      rejections: [unauthenticated, forbidden],
    });

    const validated = validateInPackage(definitions, noOrigin);

    expect(validated.kind).toBe('valid');
  });

  test('a Guard a listed Guard names, left out of the list, fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [permission],
      rejections: [unauthenticated, forbidden],
    });

    const failures = failuresOf(definitions);

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['guards'],
        rule: 'definitions-unlisted',
        message: 'A Definitions Package lists every Guard its Guards reach: userToken',
      },
    ]);
  });

  test('a Rejection a listed Guard answers, left out of the list, fails', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [userToken, permission],
      rejections: [forbidden],
    });

    const failures = failuresOf(definitions);

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['rejections'],
        rule: 'definitions-unlisted',
        message: 'A Definitions Package lists every Rejection its Guards reach: UNAUTHENTICATED',
      },
    ]);
  });

  test('a Definitions Package a Contract lists is held to the same rule, where it is listed', () => {
    const definitions = defineDefinitions({ name: 'definitions', guards: [permission] });
    const ping = defineEndpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      visibility: 'public',
      description: 'Ping',
      success: { status: 200, body: z.object({ ok: z.boolean() }) },
    });
    const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] });
    const contract = defineContract({
      name: 'ping-service',
      definitions: [definitions],
      groups: [group],
    });

    const failures = failuresOf(contract);

    expect(failures.map(({ at }) => at)).toEqual([
      ['definitions', 'definitions', 'guards'],
      ['definitions', 'definitions', 'rejections'],
      ['definitions', 'definitions', 'rejections'],
    ]);
  });
});
