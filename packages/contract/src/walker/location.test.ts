import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import {
  authorPathOf,
  pathTailOf,
  type Site,
  type Step,
  siteTextOf,
  tokenOf,
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

  test('a text on a line is itself when it is plain and JSON otherwise', () => {
    expect([tokenOf('getOrder'), tokenOf('two words')]).toEqual(['getOrder', '"two words"']);
  });
});

describe('pathTailOf', () => {
  test('steps that continue a path are written as authorPathOf writes them after a first step (seed 314)', () => {
    const next = seededNext(314);
    const pick = <Item>(items: readonly Item[]): Item =>
      items[Math.floor(next() * items.length)] as Item;
    const stepOf = (): Step =>
      pick<Step>([
        part('success'),
        part('body'),
        field('lines'),
        field('Retry After'),
        { kind: 'index', index: Math.floor(next() * 4) },
        { kind: 'option', index: Math.floor(next() * 4) },
        { kind: 'items' },
        { kind: 'rest' },
        { kind: 'key' },
        { kind: 'value' },
        { kind: 'variant', discriminator: pick(['type', 'a b']), value: '"a"' },
      ]);
    const stepsOf = (length: number) => Array.from({ length }, stepOf);
    const disagreements: string[] = [];

    for (let draw = 0; draw < 2000; draw++) {
      const head = stepsOf(1 + Math.floor(next() * 3));
      const tail = stepsOf(Math.floor(next() * 4));
      const whole = authorPathOf([...head, ...tail]);
      if (whole !== `${authorPathOf(head)}${pathTailOf(tail)}`) {
        disagreements.push(JSON.stringify({ head, tail }));
      }
    }

    expect(disagreements).toEqual([]);
  });
});
