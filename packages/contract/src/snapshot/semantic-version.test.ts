import { describe, expect, test } from 'vitest';
import { isSemanticVersion, semanticVersionPartsOf } from '../internal/index.ts';

describe('isSemanticVersion', () => {
  test.each(['0.0.0', '3.4.0', '10.20.30', '1.0.0-rc.1', '1.0.0-0.alpha-1', '1.0.0+build.5'])(
    'a semantic version, a prerelease or a build included, is one: %s',
    (version) => {
      expect(isSemanticVersion(version)).toBe(true);
    },
  );

  test.each([
    '',
    '1',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    '^1.2.3',
    '>=1.2.3',
    '1.x.0',
    'latest',
    '01.2.3',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3+',
  ])('a range, a tag, a v-prefix or a malformed number is not one: "%s"', (version) => {
    expect(isSemanticVersion(version)).toBe(false);
  });

  test('a value that is no text is not a semantic version', () => {
    expect([isSemanticVersion(3), isSemanticVersion(null), isSemanticVersion(undefined)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('semanticVersionPartsOf', () => {
  test('a version’s parts are its three numbers and its prerelease identifiers, as text', () => {
    const parts = semanticVersionPartsOf('10.0.7-rc.1.alpha-2');

    expect(parts).toEqual({ core: ['10', '0', '7'], prerelease: ['rc', '1', 'alpha-2'] });
  });

  test('a version with no prerelease has no identifiers', () => {
    const parts = semanticVersionPartsOf('1.2.3');

    expect(parts).toEqual({ core: ['1', '2', '3'], prerelease: [] });
  });

  test('a build is not one of the parts', () => {
    const parts = semanticVersionPartsOf('1.2.3-0+build-5.6');

    expect(parts).toEqual({ core: ['1', '2', '3'], prerelease: ['0'] });
  });
});
