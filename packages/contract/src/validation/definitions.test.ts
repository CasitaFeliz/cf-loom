import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  return validateContract(root, aRootPackage(root, { originOf }));
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
const admin = defineGuard({
  name: 'admin',
  description: 'The user administers',
  guards: [permission],
});
const owner = defineGuard({ name: 'owner', description: 'The user owns', guards: [admin] });

function failuresOf(root: unknown) {
  const validated = validateInPackage(root, noOrigin);
  return validated.kind === 'invalid' ? validated.failures : [];
}

describe('validateContract: a Definitions Package lists what its Guards reach', () => {
  test('a Definitions Package that lists every Guard and Rejection its Guards reach is valid', () => {
    const definitions = defineDefinitions({
      guards: [userToken, permission],
      rejections: [unauthenticated, forbidden],
    });

    const validated = validateInPackage(definitions, noOrigin);

    expect(validated.kind).toBe('valid');
  });

  test.each([
    { depth: 1, listed: [permission], unlisted: ['userToken'] },
    { depth: 2, listed: [admin], unlisted: ['userToken', 'permission'] },
    { depth: 3, listed: [owner], unlisted: ['userToken', 'permission', 'admin'] },
  ])(
    'a Guard a listed Guard reaches at depth $depth, left out of the list, fails naming it',
    ({ listed, unlisted }) => {
      const definitions = defineDefinitions({
        guards: listed,
        rejections: [unauthenticated, forbidden],
      });

      const failures = failuresOf(definitions);

      expect(failures).toEqual(
        unlisted.map((name) => ({
          kind: 'declaration',
          at: ['guards'],
          rule: 'definitions-unlisted',
          message: `A Definitions Package lists every Guard it exports or its Guards reach: ${name}`,
        })),
      );
    },
  );

  test('a Rejection a listed Guard answers, left out of the list, fails', () => {
    const definitions = defineDefinitions({
      guards: [userToken, permission],
      rejections: [forbidden],
    });

    const failures = failuresOf(definitions);

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['rejections'],
        rule: 'definitions-unlisted',
        message:
          'A Definitions Package lists every Rejection it exports or its Guards reach: UNAUTHENTICATED',
      },
    ]);
  });

  test('a Definitions Package a Contract lists is held to the same rule, where it is listed', () => {
    const definitions = defineDefinitions({ guards: [permission] });
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
      ['definitions', 0, 'guards'],
      ['definitions', 0, 'rejections'],
      ['definitions', 0, 'rejections'],
    ]);
  });
});

describe('validateContract: a listed Definitions Package lists what it exports', () => {
  const ping = defineEndpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Ping',
    success: { status: 200, body: z.object({ ok: z.boolean() }) },
  });
  const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] });
  const definitions = defineDefinitions({
    guards: [userToken],
    rejections: [unauthenticated],
  });
  const contract = defineContract({
    name: 'ping-service',
    definitions: [definitions],
    groups: [group],
  });

  function exportingFailures(exported: readonly unknown[]) {
    const validated = validateContract(
      contract,
      aRootPackage(contract, {
        originOf: noOrigin,
        packageName: 'ping-service',
        exportsOf: (listed) => (listed === definitions ? exported : []),
      }),
    );
    return validated.kind === 'invalid' ? validated.failures : [];
  }

  test('a package that lists every Guard and Rejection it exports is valid', () => {
    const failures = exportingFailures([definitions, userToken, unauthenticated, 'a constant']);

    expect(failures).toEqual([]);
  });

  test('a Guard it exports and does not list fails where the package is listed', () => {
    const failures = exportingFailures([definitions, userToken, permission]);

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['definitions', 0, 'guards'],
        rule: 'definitions-unlisted',
        message:
          'A Definitions Package lists every Guard it exports or its Guards reach: permission',
      },
      {
        kind: 'declaration',
        at: ['definitions', 0, 'rejections'],
        rule: 'definitions-unlisted',
        message:
          'A Definitions Package lists every Rejection it exports or its Guards reach: FORBIDDEN',
      },
    ]);
  });

  test('a Rejection it exports and does not list fails', () => {
    const failures = exportingFailures([definitions, forbidden]);

    expect(failures.map((failure) => failure.kind === 'declaration' && failure.message)).toEqual([
      'A Definitions Package lists every Rejection it exports or its Guards reach: FORBIDDEN',
    ]);
  });
});
