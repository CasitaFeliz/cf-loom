import { describe, expect, test } from 'vitest';
import { compareSemanticVersions, isSemanticVersion } from '../internal/index.ts';

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

describe('compareSemanticVersions', () => {
  test('versions are ordered by their numbers, not their text', () => {
    const versions = ['1.10.0', '1.2.0', '2.0.0', '1.2.10', '1.2.9'];

    const ordered = [...versions].sort(compareSemanticVersions);

    expect(ordered).toEqual(['1.2.0', '1.2.9', '1.2.10', '1.10.0', '2.0.0']);
  });

  test('prereleases come before their release, ordered as semver.org orders them', () => {
    const ascending = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];

    const ordered = [...ascending].reverse().sort(compareSemanticVersions);

    expect(ordered).toEqual(ascending);
  });

  test('numbers beyond what a double holds still order exactly', () => {
    const below = '9007199254740992.0.0';
    const above = '9007199254740993.0.0';

    const order = compareSemanticVersions(below, above);

    expect(order).toBeLessThan(0);
  });

  test('prerelease numbers beyond what a double holds still order exactly', () => {
    const below = '1.0.0-9007199254740992';
    const above = '1.0.0-9007199254740993';

    const order = compareSemanticVersions(above, below);

    expect(order).toBeGreaterThan(0);
  });

  test('build metadata does not order versions', () => {
    const order = compareSemanticVersions('1.0.0+a', '1.0.0+b');

    expect(order).toBe(0);
  });

  test('an order is antisymmetric', () => {
    const forwards = compareSemanticVersions('1.0.0-rc.1', '1.0.0');
    const backwards = compareSemanticVersions('1.0.0', '1.0.0-rc.1');

    expect([Math.sign(forwards), Math.sign(backwards)]).toEqual([-1, 1]);
  });
});
