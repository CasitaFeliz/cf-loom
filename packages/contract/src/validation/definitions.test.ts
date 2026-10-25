import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

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
const ping = defineEndpoint({
  name: 'ping',
  method: 'GET',
  path: '/ping',
  visibility: 'public',
  description: 'Ping',
  success: { status: 200, body: z.object({ ok: z.boolean() }) },
});

/** The failures of a Definitions root whose file exports what is given beside it. */
function failuresOf(exported: Readonly<Record<string, unknown>>) {
  const root = defineDefinitions({});
  const validated = validateContract(
    root,
    aRootPackage(root, { rootExports: { definitions: root, ...exported } }),
  );
  return validated.kind === 'invalid' ? validated.failures : [];
}

describe('validateContract: a Definitions Package exports what its Guards reach', () => {
  test('a Definitions Package that exports every Guard and Rejection its Guards reach is valid', () => {
    const failures = failuresOf({ userToken, permission, unauthenticated, forbidden });

    expect(failures).toEqual([]);
  });

  test.each([
    { depth: 1, exported: { permission }, unexported: ['userToken'] },
    { depth: 2, exported: { admin }, unexported: ['userToken', 'permission'] },
    { depth: 3, exported: { owner }, unexported: ['userToken', 'permission', 'admin'] },
  ])(
    'a Guard an exported Guard reaches at depth $depth, left unexported, fails naming it',
    ({ exported, unexported }) => {
      const [name] = Object.keys(exported);

      const failures = failuresOf({ ...exported, unauthenticated, forbidden });

      expect(failures).toEqual(
        unexported.map((guard) => ({
          kind: 'declaration',
          at: ['exports', name],
          rule: 'definitions-unexported',
          message: `${unexportedMessage}: ${guard}`,
        })),
      );
    },
  );

  test('a Rejection an exported Guard answers, left unexported, fails', () => {
    const failures = failuresOf({ userToken, permission, forbidden });

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['exports', 'permission'],
        rule: 'definitions-unexported',
        message: `${unexportedMessage}: UNAUTHENTICATED`,
      },
    ]);
  });

  test.each([
    { depth: 1, links: 1 },
    { depth: 2, links: 2 },
    { depth: 3, links: 3 },
  ])(
    'every link of a chain of $depth Guards left unexported fails, and none exported does',
    ({ links }) => {
      const chain = [userToken, permission, admin, owner].slice(0, links + 1);
      const top = chain.at(-1);
      const rejections = { unauthenticated, forbidden };

      for (let mask = 0; mask < 2 ** links; mask += 1) {
        const kept = chain.slice(0, -1).filter((_, index) => (mask >> index) % 2 === 1);
        const exported = Object.fromEntries([top, ...kept].map((guard) => [guard?.name, guard]));

        const failures = failuresOf({ ...exported, ...rejections });

        expect(failures).toHaveLength(links - kept.length);
      }
    },
  );
});

describe('validateContract: a Definitions Package’s root file exports only what it shares', () => {
  test.each([
    ['a function', () => true],
    ['a number', 100],
    ['an Endpoint, which a Definitions Package never owns', ping],
    ['a second Definitions Package', defineDefinitions({})],
  ])('an export that is %s fails definitions-export', (_, value) => {
    const failures = failuresOf({ other: value });

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['exports', 'other'],
        rule: 'definitions-export',
        message: `${exportsOnly}: other is none of them`,
      },
    ]);
  });

  test('the Definitions object exported under a second name fails definitions-export', () => {
    const root = defineDefinitions({});
    const rootExports = { definitions: root, again: root };

    const validated = validateContract(root, aRootPackage(root, { rootExports }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['exports', 'again'],
          rule: 'definitions-export',
          message: `${exportsOnly}: its definitions once, as definitions, not as again`,
        },
      ],
    });
  });

  test('a schema exported as __proto__ fails definitions-export', () => {
    const exported = Object.defineProperty({}, '__proto__', {
      value: z.object({ amount: z.int() }),
      enumerable: true,
    });

    const failures = failuresOf(exported);

    expect(failures).toEqual([
      {
        kind: 'declaration',
        at: ['exports', '__proto__'],
        rule: 'definitions-export',
        message: `${exportsOnly}: nothing named __proto__, which no Snapshot can hold`,
      },
    ]);
  });

  test('an installed Definitions Package a Contract uses is not judged by what it exports', () => {
    const definitions = defineDefinitions({});
    const contract = defineContract({
      name: 'ping-service',
      groups: [defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] })],
    });
    const packages = [anInstalledPackage(definitions, { permission, helper: () => true })];

    const validated = validateContract(contract, aRootPackage(contract, { packages }));

    expect(validated.kind).toBe('valid');
  });
});

const unexportedMessage =
  'A Definitions Package exports every Guard and Rejection its Guards reach, since Services import them to attach and to reject';
const exportsOnly =
  "A Definitions Package's root file exports only its definitions, Guards, Rejections and zod schemas";
