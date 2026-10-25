import { describe, expect, test } from 'vitest';
import {
  bumpedVersionOf,
  compareSemanticVersions,
  type Deriving,
  derivedVersionOf,
  isPrerelease,
  listedVersionsOf,
  nextPrereleaseOf,
} from './index.ts';

describe('listedVersionsOf', () => {
  test('with only prereleases listed, the Baseline is the highest and there is no stable version', () => {
    const listed = listedVersionsOf(['1.0.0-0', '1.0.0-1']);

    expect(listed).toEqual({ baseline: '1.0.0-1', stable: undefined });
  });

  test('with a prerelease above a stable version, the Baseline is the prerelease and the stable version is the highest one that is not', () => {
    const listed = listedVersionsOf(['1.0.0', '1.1.0-0']);

    expect(listed).toEqual({ baseline: '1.1.0-0', stable: '1.0.0' });
  });

  test('with the stable version highest, it is the Baseline and the stable version', () => {
    const listed = listedVersionsOf(['1.0.0', '1.1.0-0', '1.1.0']);

    expect(listed).toEqual({ baseline: '1.1.0', stable: '1.1.0' });
  });

  test('with nothing listed there is no Baseline and no stable version', () => {
    const listed = listedVersionsOf([]);

    expect(listed).toEqual({ baseline: undefined, stable: undefined });
  });
});

type Bump = 'unchanged' | 'patch' | 'minor' | 'major';

/** What `publish` derives from, with these versions listed lowest first, changes of this size against the Baseline and these options. */
function derivingFrom(
  versions: readonly string[],
  bump: Bump,
  options: { readonly force?: boolean; readonly prerelease?: boolean } = {},
): Deriving {
  const { force = false, prerelease = false } = options;
  const baseline = { version: versions.at(-1)!, bump };
  return { baseline, versions, force, prerelease };
}

describe('derivedVersionOf', () => {
  test.for([
    ['only prereleases listed, whatever changed', '1.0.0', ['1.0.0-0', '1.0.0-1'], 'major'],
    ['a prerelease above a stable version, a patch', '1.1.0', ['1.0.0', '1.1.0-0'], 'patch'],
    ['a prerelease above a stable version, a major', '2.0.0', ['1.0.0', '1.1.0-0'], 'major'],
    [
      'a prerelease above a stable version, nothing changed',
      '1.1.0',
      ['1.0.0', '1.1.0-0'],
      'unchanged',
    ],
    ['a stable version, a minor', '1.1.0', ['1.0.0'], 'minor'],
    ['a stable version, a patch', '1.4.8', ['1.4.7'], 'patch'],
  ] as const)('with %s, publish takes the version %s', ([, version, versions, bump]) => {
    const derived = derivedVersionOf(derivingFrom(versions, bump));

    expect(derived).toMatchObject({ kind: 'version', version });
  });

  test.for([
    ['only prereleases listed, whatever changed', '1.0.0-2', ['1.0.0-0', '1.0.0-1'], 'major'],
    ['a prerelease above a stable version, a patch', '1.1.0-1', ['1.0.0', '1.1.0-0'], 'patch'],
    ['a prerelease above a stable version, a major', '2.0.0-0', ['1.0.0', '1.1.0-0'], 'major'],
    ['a stable version, a minor', '1.1.0-0', ['1.0.0'], 'minor'],
  ] as const)(
    'with %s, publish --prerelease takes the version %s',
    ([, version, versions, bump]) => {
      const derived = derivedVersionOf(derivingFrom(versions, bump, { prerelease: true }));

      expect(derived).toMatchObject({ kind: 'version', version });
    },
  );

  test('a package never published takes 1.0.0', () => {
    const derived = derivedVersionOf({
      baseline: undefined,
      versions: [],
      force: false,
      prerelease: false,
    });

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0' });
  });

  test('a package never published takes 1.0.0-0 with --prerelease', () => {
    const derived = derivedVersionOf({
      baseline: undefined,
      versions: [],
      force: false,
      prerelease: true,
    });

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-0' });
  });

  test('nothing changed over a prerelease Baseline publishes nothing with --prerelease', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0-0'], 'unchanged', { prerelease: true }),
    );

    expect(derived).toEqual({ kind: 'unchanged', baseline: '1.1.0-0' });
  });

  test('nothing changed over a stable Baseline publishes nothing', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '1.1.0'], 'unchanged'));

    expect(derived).toEqual({ kind: 'unchanged', baseline: '1.1.0' });
  });

  test('nothing changed over a stable Baseline publishes no prerelease either', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0'], 'unchanged', { prerelease: true }),
    );

    expect(derived).toEqual({ kind: 'unchanged', baseline: '1.1.0' });
  });

  test('--force over an unchanged prerelease Baseline publishes the next prerelease', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0-0', '1.0.0-1'], 'unchanged', { force: true, prerelease: true }),
    );

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-2' });
  });

  test('--force over an unchanged stable Baseline publishes a patch', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0'], 'unchanged', { force: true }));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.1' });
  });

  test('a version that is not a prerelease takes the latest dist-tag', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '1.1.0-0'], 'patch'));

    expect(derived).toMatchObject({ kind: 'version', tag: 'latest' });
  });

  test('a first prerelease takes the latest dist-tag', () => {
    const derived = derivedVersionOf({
      baseline: undefined,
      versions: [],
      force: false,
      prerelease: true,
    });

    expect(derived).toMatchObject({ kind: 'version', tag: 'latest' });
  });

  test('a prerelease takes the latest dist-tag while no stable version is listed', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0-0', '1.0.0-1'], 'patch', { prerelease: true }),
    );

    expect(derived).toMatchObject({ kind: 'version', tag: 'latest' });
  });

  test('a prerelease takes the next dist-tag once a stable version is listed', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0-0'], 'patch', { prerelease: true }),
    );

    expect(derived).toMatchObject({ kind: 'version', tag: 'next' });
  });
});

describe('isPrerelease', () => {
  test('a version with a prerelease is one, and one without is not', () => {
    const versions = ['1.0.0-rc.1', '0.0.0-0', '2.1.0-alpha+build.5', '1.0.0', '3.4.5+build'];

    const flags = versions.map(isPrerelease);

    expect(flags).toEqual([true, true, true, false, false]);
  });

  test('a hyphen in the build does not make a prerelease', () => {
    const versions = ['1.0.0+build-1', '1.0.0+rc-1.2'];

    const flags = versions.map(isPrerelease);

    expect(flags).toEqual([false, false]);
  });
});

describe('compareSemanticVersions', () => {
  test('versions are ordered by their numbers, not their text', () => {
    const versions = ['1.10.0', '1.2.0', '2.0.0', '1.2.10', '1.2.9'];

    const ordered = [...versions].sort(compareSemanticVersions);

    expect(ordered).toEqual(['1.2.0', '1.2.9', '1.2.10', '1.10.0', '2.0.0']);
  });

  test('a prerelease comes before the same version that is not a prerelease, and prereleases order as semver.org orders them', () => {
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

  test.each([
    ['1.0.0-123', '1.0.0-1a'],
    ['1.0.0-111', '1.0.0-a1'],
  ])('a numeric identifier comes before one with a letter in it: %s before %s', (lower, higher) => {
    const order = compareSemanticVersions(lower, higher);

    expect([Math.sign(order), Math.sign(compareSemanticVersions(higher, lower))]).toEqual([-1, 1]);
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

describe('bumpedVersionOf', () => {
  test.each([
    ['major', '1.4.7', '2.0.0'],
    ['minor', '1.4.7', '1.5.0'],
    ['patch', '1.4.7', '1.4.8'],
    ['major', '0.0.0', '1.0.0'],
    ['minor', '0.9.9', '0.10.0'],
    ['patch', '0.0.9', '0.0.10'],
  ] as const)('a %s bump of %s is %s', (bump, version, bumped) => {
    expect(bumpedVersionOf(version, bump)).toBe(bumped);
  });

  test('a bump of a prerelease or a build is a plain version of the numbers raised', () => {
    const bumped = [
      bumpedVersionOf('1.4.7-rc.1', 'patch'),
      bumpedVersionOf('1.4.7+build.5', 'minor'),
    ];

    expect(bumped).toEqual(['1.4.8', '1.5.0']);
  });

  test('numbers beyond what a double holds are still raised exactly', () => {
    const bumped = bumpedVersionOf('1.0.9007199254740993', 'patch');

    expect(bumped).toBe('1.0.9007199254740994');
  });
});

describe('nextPrereleaseOf', () => {
  test('a version no prerelease of it is listed for takes the counter 0', () => {
    const next = nextPrereleaseOf('1.1.0', ['1.0.0', '1.0.1']);

    expect(next).toBe('1.1.0-0');
  });

  test('the counter is one above the highest listed for the same numbers', () => {
    const listed = ['1.1.0-0', '1.1.0-3', '1.1.0-12', '1.1.0-2'];

    const next = nextPrereleaseOf('1.1.0', listed);

    expect(next).toBe('1.1.0-13');
  });

  test('a prerelease of other numbers, one with a name or several identifiers, and the version itself are not counted', () => {
    const listed = [
      '1.0.0-7',
      '1.1.0',
      '1.1.0-rc.1',
      '1.1.0-1.2',
      '1.1.0-1a',
      '2.0.0-3',
      '1.1.0-0',
    ];

    const next = nextPrereleaseOf('1.1.0', listed);

    expect(next).toBe('1.1.0-1');
  });

  test('a counter beyond what a double holds is still raised exactly', () => {
    const next = nextPrereleaseOf('1.0.0', ['1.0.0-9007199254740993']);

    expect(next).toBe('1.0.0-9007199254740994');
  });

  test('the build of a listed version does not change its counter', () => {
    const next = nextPrereleaseOf('1.0.0', ['1.0.0-4+build.1']);

    expect(next).toBe('1.0.0-5');
  });
});
