import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { refusalsOf } from '../../test/failures.ts';
import { type Construct, constructs, pathTextOf, randomNested } from '../../test/random-places.ts';
import { seededNext } from '../../test/random-schemas.ts';
import {
  authorPathOf,
  type Site,
  type Step,
  siteTextOf,
  snapshotPathOf,
  tokenOf,
  walkSchemas,
} from '../internal/index.ts';

const field = (name: string): Step => ({ kind: 'field', name });
const part = (name: 'success' | 'body'): Step => ({ kind: 'part', name });

describe('siteTextOf', () => {
  test.for([
    [{ kind: 'root' }, '(root)'],
    [
      { kind: 'endpoint', identity: 'GET /orders/{}', name: 'getOrder' },
      'endpoints.GET /orders/{} (getOrder)',
    ],
    [{ kind: 'event', identity: 'OrderCreated@2' }, 'events.OrderCreated@2'],
    [{ kind: 'command', identity: 'ChargeCard@1' }, 'commands.ChargeCard@1'],
    [{ kind: 'code', code: 'ORDER_LOCKED' }, 'codes.ORDER_LOCKED'],
    [{ kind: 'group', name: 'orders' }, 'groups.orders'],
    [{ kind: 'guard', name: 'apiKey' }, 'guards.apiKey'],
    [{ kind: 'subscription', name: 'notifyOnSettled' }, 'subscriptions.notifyOnSettled'],
    [{ kind: 'dependency', name: 'payments-service' }, 'dependencies.payments-service'],
    [{ kind: 'export', name: 'money' }, 'exports.money'],
    [{ kind: 'standard-rejection', name: 'notFound' }, 'standardRejections.notFound'],
    [{ kind: 'def', name: 'tree' }, 'defs.tree'],
    [{ kind: 'group', name: 'two words' }, 'groups."two words"'],
  ] as const satisfies readonly (readonly [Site, string])[])(
    'a site is named as the Check names it: %j',
    ([site, text]) => {
      expect(siteTextOf(site)).toBe(text);
    },
  );
});

describe('authorPathOf', () => {
  test.for([
    ['no steps', [], null],
    ['parts and fields', [part('success'), part('body'), field('v')], 'success.body.v'],
    ['an array', [field('orders'), { kind: 'items' }], 'orders[]'],
    ['a tuple rest', [field('pair'), { kind: 'rest' }], 'pair[...]'],
    ['a record', [field('tags'), { kind: 'key' }, { kind: 'value' }], 'tags{key}{}'],
    [
      'a variant',
      [field('kind'), { kind: 'variant', discriminator: 'type', value: '"a"' }],
      'kind<type="a">',
    ],
    ['a tuple item', [field('pair'), { kind: 'index', index: 1 }], 'pair[1]'],
    ['a list position', [field('rejections'), { kind: 'index', index: 0 }], 'rejections[0]'],
    ['a union option', [field('either'), { kind: 'option', index: 2 }], 'either<|2>'],
    ['a field that is no plain token', [field('Retry After')], '"Retry After"'],
  ] as const satisfies readonly (readonly [string, readonly Step[], string | null])[])(
    'steps are written in the author’s terms: %s',
    ([, steps, text]) => {
      expect(authorPathOf(steps)).toBe(text);
    },
  );

  test.for([
    ['no steps', [], 'tree', 'defs.tree'],
    ['a field', [field('name')], 'tree', 'defs.tree.name'],
    ['an array', [field('children'), { kind: 'items' }], 'tree', 'defs.tree.children[]'],
    ['an id that is no plain token', [field('x')], 'two words', 'defs."two words".x'],
  ] as const satisfies readonly (readonly [string, readonly Step[], string, string])[])(
    'steps below a recursive schema start at its id: %s',
    ([, steps, def, text]) => {
      expect(authorPathOf(steps, def)).toBe(text);
    },
  );

  test.for(['tree', 'two words', 'constructor'])(
    'a recursive schema is named in a path as a failure names it as a site: %s',
    (def) => {
      expect(authorPathOf([], def)).toBe(siteTextOf({ kind: 'def', name: def }));
    },
  );

  test('a text on a line is itself when it is plain and JSON otherwise', () => {
    expect([tokenOf('getOrder'), tokenOf('two words')]).toEqual(['getOrder', '"two words"']);
  });
});

describe('snapshotPathOf', () => {
  test('steps below a recursive schema are a Snapshot path from its id in defs', () => {
    const steps = [field('children'), { kind: 'items' }] as const;

    expect([
      snapshotPathOf(steps),
      snapshotPathOf(steps, 'tree'),
      snapshotPathOf([], 'tree'),
    ]).toEqual([
      ['fields', 'children', 'items'],
      ['defs', 'tree', 'fields', 'children', 'items'],
      ['defs', 'tree'],
    ]);
  });
});

describe('the steps of a place', () => {
  const body = {
    site: { kind: 'export', name: 'body' },
    declaration: undefined,
    steps: undefined,
  } as const;
  const seedCount = 1_000;

  /** A random nested schema with a `z.date()` at every leaf, and the steps down to each as they were written. */
  function datedSchemaOf(seed: number) {
    const next = seededNext(seed);
    return randomNested({ next, leaf: () => z.date(), keysHoldLeaves: true }, 4);
  }

  test('every refusal sits at the steps it was written at, in random nested schemas', () => {
    const wrong: string[] = [];
    const crossed = new Set<Construct>();

    for (let seed = 1; seed <= seedCount; seed++) {
      const { schema, leaves } = datedSchemaOf(seed);
      const walked = refusalsOf(walkSchemas([{ at: body, schema }], () => undefined));
      const [located] = walked.located;
      const refused = located?.kind === 'not-allowed' ? located.failures.map(({ at }) => at) : [];
      const written = leaves.map(({ steps }) => pathTextOf(steps));
      if (JSON.stringify([...refused].sort()) !== JSON.stringify([...written].sort())) {
        wrong.push(`seed ${seed}: ${JSON.stringify(refused)} not ${JSON.stringify(written)}`);
      }
      for (const leaf of leaves) {
        for (const construct of leaf.crossing) {
          crossed.add(construct);
        }
      }
    }

    expect(wrong).toEqual([]);
    expect([...crossed].sort()).toEqual([...constructs].sort());
  });
});
