import { describe, expect, test } from 'vitest';
import { isAbsentAt, ownOf } from '../internal/index.ts';

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
