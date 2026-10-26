import { describe, expect, test } from 'vitest';
import {
  authorPathOf,
  fieldStep,
  indexStep,
  itemsStep,
  keyStep,
  optionStep,
  partsOf,
  restStep,
  type Site,
  type Step,
  siteLocationOf,
  siteTextOf,
  tokenOf,
  valueStep,
  variantStep,
} from '../internal/index.ts';

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
    [{ kind: 'definitions', label: '@org/definitions' }, '@org/definitions'],
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
    ['parts and fields', [...partsOf('success', 'body'), fieldStep('v')], 'success.body.v'],
    [
      'an array',
      [...partsOf('success', 'body'), fieldStep('orders'), itemsStep],
      'success.body.orders[]',
    ],
    ['a tuple rest', [fieldStep('pair'), restStep], 'pair[...]'],
    ['a record', [fieldStep('tags'), keyStep, valueStep], 'tags{key}{}'],
    ['a variant', [fieldStep('kind'), variantStep('type', '"a"')], 'kind<type="a">'],
    ['a tuple item', [fieldStep('pair'), indexStep(1)], 'pair[1]'],
    ['a list position of a declaration', [fieldStep('rejections'), indexStep(0)], 'rejections[0]'],
    ['a union option', [fieldStep('either'), optionStep(2)], 'either<|2>'],
    ['a field that is no plain token', [fieldStep('Retry After')], '"Retry After"'],
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

describe('siteLocationOf', () => {
  test('a location is its site, then its steps', () => {
    const site: Site = { kind: 'endpoint', identity: 'POST /b/{}', name: 'createThing' };

    expect(siteLocationOf(site, [fieldStep('visibility')])).toBe(
      'endpoints.POST /b/{} (createThing) visibility',
    );
  });

  test('a location without steps is its site alone', () => {
    expect(siteLocationOf({ kind: 'code', code: 'LOCKED' }, [])).toBe('codes.LOCKED');
  });

  test('a declaration listed by position is named by its holder and the position', () => {
    const steps = [fieldStep('endpoints'), indexStep(2)];

    expect(siteLocationOf({ kind: 'group', name: 'orders' }, steps)).toBe(
      'groups.orders endpoints[2]',
    );
  });
});
