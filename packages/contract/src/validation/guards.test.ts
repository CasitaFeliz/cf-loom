import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import {
  type Attachment,
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
  type Guard,
} from '../index.ts';
import { type OriginOf, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: OriginOf) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
}

/** What a Guard may demand, so a cast can put a part there the types refuse. */
type Demands = { readonly headers: core.$ZodObject };

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
});

const quota = defineGuard({
  name: 'quota',
  description: 'The client stays within a quota',
  qualifier: z.object({ perMinute: z.int(), burst: z.object({ size: z.int() }).optional() }),
});

/** The result of validating one Endpoint with these Attachments, cast where the types refuse them. */
function validateGuards(guards: readonly Attachment[]) {
  const endpoint = defineEndpoint({ ...listing, guards });
  return validateEndpoint(endpoint);
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(
    defineContract({ name: 'orders-service', groups: [orders] }),
    () => undefined,
  );
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

const guardsAt = ['groups', 'orders', 'endpoints', 'GET /orders', 'guards'];

describe('validateContract: what a Guard demands', () => {
  test('a Guard demanding headers and query validates', () => {
    const paged = defineGuard({
      name: 'paged',
      description: 'A page',
      demands: { headers: z.object({ 'x-page': z.int() }), query: z.object({ page: z.int() }) },
    });

    expect(validateGuards([paged]).kind).toBe('valid');
  });

  test('a Guard demanding the body fails', () => {
    const demands = { body: z.object({ signature: z.string() }) } as unknown as Demands;
    const signed = defineGuard({ name: 'signed', description: 'A signed body', demands });

    expect(validateGuards([signed])).toEqual(
      failed(
        ['guards', 'signed', 'demands', 'body'],
        'guard-demands',
        'A Guard demands only headers and query',
      ),
    );
  });

  test('a Guard demanding path params fails', () => {
    const demands = { params: z.object({ tenantId: z.string() }) } as unknown as Demands;
    const tenant = defineGuard({ name: 'tenant', description: 'A tenant in the path', demands });

    expect(validateGuards([tenant])).toEqual(
      failed(
        ['guards', 'tenant', 'demands', 'params'],
        'guard-demands',
        'A Guard demands only headers and query',
      ),
    );
  });
});

describe('validateContract: the order of an Endpoint’s Guards', () => {
  test('a dependent Guard after the Guards it lists validates', () => {
    expect(
      validateGuards([userToken, { guard: permission, qualifier: ['orders:edit'] }]).kind,
    ).toBe('valid');
  });

  test('a dependent Guard before a Guard it lists fails', () => {
    const guards: readonly Attachment[] = [
      { guard: permission, qualifier: ['orders:edit'] },
      userToken,
    ];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 0], 'guard-order', 'permission requires userToken earlier in guards'),
    );
  });

  test('a Guard listed twice fails', () => {
    const guards: readonly Attachment[] = [userToken, userToken];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 1], 'guard-once', 'userToken is listed twice'),
    );
  });

  test('a Guard listed twice is checked once for its dependencies', () => {
    const guards: readonly Attachment[] = [
      userToken,
      { guard: permission, qualifier: ['orders:edit'] },
      { guard: permission, qualifier: ['orders:read'] },
    ];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 2], 'guard-once', 'permission is listed twice'),
    );
  });
});

describe('validateContract: bare and qualified Attachments', () => {
  test('a Guard with a qualifier listed bare fails', () => {
    const guards: readonly Attachment[] = [userToken, permission];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 1],
        'attachment-needs-qualifier',
        'permission needs a qualifier: { guard, qualifier }',
      ),
    );
  });

  test('a qualified Attachment of a Guard without a qualifier fails', () => {
    const guards: readonly Attachment[] = [{ guard: userToken, qualifier: 'anything' }];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 0], 'attachment-takes-no-qualifier', 'userToken takes no qualifier'),
    );
  });

  test('an Attachment that names no Guard fails', () => {
    const guards = ['userToken'] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0],
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });
});

describe('validateContract: Attachments written without a Guard or a Qualifier', () => {
  test('a qualified Attachment whose guard is null fails once, as a required field', () => {
    const guards = [{ guard: null, qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 0, 'guard'], 'required-field', 'guard is a required field'),
    );
  });

  test('a qualified Attachment without a guard fails once, as a required field', () => {
    const guards = [{ qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 0, 'guard'], 'required-field', 'guard is a required field'),
    );
  });

  test('a qualified Attachment whose guard is no Guard still fails as no Attachment', () => {
    const guards = [{ guard: 'tenant', qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0],
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });

  test('a Qualifier written null fails once, as a required field', () => {
    const guards = [{ guard: quota, qualifier: null }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed([...guardsAt, 0, 'qualifier'], 'required-field', 'qualifier is a required field'),
    );
  });
});

describe('validateContract: a Qualifier against its schema', () => {
  test('a Qualifier its schema accepts validates', () => {
    expect(validateGuards([{ guard: quota, qualifier: { perMinute: 60 } }]).kind).toBe('valid');
  });

  test('a Qualifier its schema refuses fails', () => {
    const guards: readonly Attachment[] = [{ guard: quota, qualifier: { perMinute: 'many' } }];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-value',
        'quota takes a Qualifier its schema accepts',
      ),
    );
  });

  test('an empty list where the schema asks for one item fails', () => {
    const guards: readonly Attachment[] = [userToken, { guard: permission, qualifier: [] }];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 1, 'qualifier'],
        'qualifier-value',
        'permission takes a Qualifier its schema accepts',
      ),
    );
  });

  test('an undeclared key in an object Qualifier fails', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, extra: true } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: extra',
      ),
    );
  });

  test('an undeclared key in an object nested in a Qualifier fails', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, burst: { size: 5, every: 'minute' } } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: burst.every',
      ),
    );
  });

  test('an undeclared key in an object listed in a Qualifier fails', () => {
    const roles = defineGuard({
      name: 'roles',
      description: 'The user holds one of the roles',
      qualifier: z.array(z.object({ role: z.string() })),
    });
    const guards: readonly Attachment[] = [
      { guard: roles, qualifier: [{ role: 'admin' }, { role: 'clerk', extra: true }] },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: 1.extra',
      ),
    );
  });

  test('a Qualifier that is a variant of a discriminated union holds only that variant’s keys', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('all') }),
        z.object({ kind: z.literal('tenant'), tenantId: z.string() }),
      ]),
    });
    const accepted = validateGuards([
      { guard: scope, qualifier: { kind: 'tenant', tenantId: 'acme' } },
    ]);
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { kind: 'all', tenantId: 'acme' } },
    ];

    expect(accepted.kind).toBe('valid');
    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: tenantId',
      ),
    );
  });

  test('a Qualifier that fits no option of a union is judged by the closest option', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.union([
        z.object({ tenantId: z.string() }),
        z.object({ region: z.string(), zone: z.string().optional() }),
      ]),
    });
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { region: 'eu', zone: 'west', extra: true } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: extra',
      ),
    );
  });

  test('a Qualifier of an intersection holds the keys any of its items declares', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.intersection(
        z.object({ tenantId: z.string() }).describe('The tenant'),
        z.object({ region: z.string() }).describe('The region'),
      ),
    });
    const accepted = validateGuards([
      { guard: scope, qualifier: { tenantId: 'acme', region: 'eu' } },
    ]);
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { tenantId: 'acme', region: 'eu', extra: true } },
    ];

    expect(accepted.kind).toBe('valid');
    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: extra',
      ),
    );
  });

  test('a Qualifier of a recursive schema is judged through its refs', () => {
    type Node = { name: string; children: Node[] };
    const node: z.ZodType<Node> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(node) }))
      .meta({ id: 'node' });
    const tree = defineGuard({ name: 'tree', description: 'A tree of scopes', qualifier: node });
    const guards: readonly Attachment[] = [
      {
        guard: tree,
        qualifier: { name: 'root', children: [{ name: 'leaf', children: [], extra: 1 }] },
      },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 0, 'qualifier'],
        'qualifier-keys',
        'A Qualifier holds only the keys its schema declares: children.0.extra',
      ),
    );
  });

  test('a Qualifier is not judged while its schema holds a construct that is not allowed', () => {
    const refined = defineGuard({
      name: 'refined',
      description: 'A refined qualifier',
      qualifier: z.string().refine((value) => value !== '') as core.$ZodType,
    });
    const guards: readonly Attachment[] = [{ guard: refined, qualifier: 7 }];

    expect(validateGuards(guards)).toEqual({
      kind: 'invalid',
      failures: [
        { kind: 'not-allowed', at: ['guards', 'refined', 'qualifier'], construct: '.refine()' },
      ],
    });
  });
});

describe('validateContract: Guards typed wider than their declarations', () => {
  test('a Guard typed as any Guard is checked by what it declares', () => {
    const guard: Guard = permission;
    const guards: readonly Attachment[] = [userToken, guard];

    expect(validateGuards(guards)).toEqual(
      failed(
        [...guardsAt, 1],
        'attachment-needs-qualifier',
        'permission needs a qualifier: { guard, qualifier }',
      ),
    );
  });
});
