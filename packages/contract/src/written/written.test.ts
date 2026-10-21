import { describe, expect, test } from 'vitest';
import { ownOf } from '../internal/index.ts';

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
