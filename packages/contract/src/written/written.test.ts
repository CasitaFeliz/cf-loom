import { describe, expect, test } from 'vitest';
import { foreignValues } from '../../test/foreign-values.ts';
import { isAbsentAt, kindWordsOf, ownOf, textOf } from '../internal/index.ts';

function aRevokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

const manyCharacters = 'x'.repeat(100_000);

/** Values with no text of their own and the words that name each, a Proxy by what it stands for and a revoked one an object. */
const named = [
  { label: 'a function', value: () => 1, words: 'a function' },
  { label: 'a symbol', value: Symbol('x'), words: 'a symbol' },
  {
    label: 'a symbol described by many characters',
    value: Symbol(manyCharacters),
    words: 'a symbol',
  },
  { label: 'a bigint', value: 1n, words: 'a bigint' },
  { label: 'a bigint of many digits', value: 10n ** 10_000n, words: 'a bigint' },
  { label: 'a list', value: [1], words: 'a list' },
  { label: 'a list with holes', value: new Array(2), words: 'a list' },
  { label: 'an object', value: { a: 1 }, words: 'an object' },
  { label: 'an object with no prototype', value: Object.create(null), words: 'an object' },
  { label: 'a Proxy of a list', value: new Proxy([], {}), words: 'a list' },
  { label: 'a Proxy of an object', value: new Proxy({}, {}), words: 'an object' },
  { label: 'a Proxy of a function', value: new Proxy(() => 1, {}), words: 'a function' },
  { label: 'a revoked Proxy', value: aRevokedProxy(), words: 'an object' },
];

/** Values whose text is their own. */
const texted = [
  { label: 'a string', value: 'orders', text: 'orders' },
  { label: 'a number', value: 5, text: '5' },
  { label: 'negative zero', value: -0, text: '0' },
  { label: 'a boolean', value: true, text: 'true' },
  { label: 'null', value: null, text: 'null' },
  { label: 'undefined', value: undefined, text: 'undefined' },
];

describe('kindWordsOf', () => {
  test.for(named)('$label is named $words', ({ value, words }) => {
    expect(kindWordsOf(value)).toBe(words);
  });

  test.for(texted)('$label has text of its own, so no words', ({ value }) => {
    expect(kindWordsOf(value)).toBeUndefined();
  });

  test('every value of the pool of values no setting type allows is named, and none of its code runs', () => {
    const ran: string[] = [];
    const counting = () => {
      ran.push('ran');
      return 'x';
    };

    const unnamed = foreignValues(counting).filter(({ value }) => kindWordsOf(value) === undefined);

    expect(unnamed).toEqual([]);
    expect(ran).toEqual([]);
  });
});

describe('textOf', () => {
  test.for(named)('$label reads as $words', ({ value, words }) => {
    expect(textOf(value)).toBe(words);
  });

  test.for(texted)('$label reads as its own text', ({ value, text }) => {
    expect(textOf(value)).toBe(text);
  });
});

describe('ownOf', () => {
  test('a value a map holds itself is read; one it only inherits, or any of a list or a non-object, never', () => {
    const inherited = Object.create({ chargeCardV1: 'inherited' });

    const values = [
      ownOf({ chargeCardV1: 'own' }, 'chargeCardV1'),
      ownOf(inherited, 'chargeCardV1'),
      ownOf(['own'], '0'),
      ownOf('text', 'length'),
      ownOf(null, 'chargeCardV1'),
    ];

    expect(values).toEqual(['own', undefined, undefined, undefined, undefined]);
  });
});

describe('isAbsentAt', () => {
  const sparse = Array.of<string>();
  sparse[1] = 'second';

  test.for([
    ['a key the object holds', { name: 'orders' }, ['name'], false],
    ['a key the object lacks', {}, ['name'], true],
    ['a key only the prototype has', {}, ['constructor'], true],
    ['a key below a key the object lacks', {}, ['holder', 'name'], true],
    ['a key of a value that is no object', 'text', ['length'], true],
    ['a key written as undefined', { name: undefined }, ['name'], true],
    ['a key written as null', { name: null }, ['name'], false],
    ['an item of a list', ['first'], [0], false],
    ['a hole of a list', sparse, [0], true],
    ['the root, when it is a value', {}, [], false],
    ['the root, when it is undefined', undefined, [], true],
  ] as const)('%s', ([_, input, path, isAbsent]) => {
    const absent = isAbsentAt(input, path);

    expect(absent).toBe(isAbsent);
  });
});
