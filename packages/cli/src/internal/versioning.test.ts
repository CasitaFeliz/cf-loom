import { describe, expect, test } from 'vitest';
import { type Deriving, derivedVersionOf, listedVersionsOf } from './index.ts';

describe('listedVersionsOf', () => {
  test('with only prereleases listed, the highest is the last and there is no stable version', () => {
    const listed = listedVersionsOf(['1.0.0-0', '1.0.0-1']);

    expect(listed).toEqual({ highest: '1.0.0-1', stable: undefined });
  });

  test('with a prerelease above a stable version, the stable version is the highest one that is not a prerelease', () => {
    const listed = listedVersionsOf(['1.0.0', '1.1.0-0']);

    expect(listed).toEqual({ highest: '1.1.0-0', stable: '1.0.0' });
  });

  test('with the stable version highest, it is both', () => {
    const listed = listedVersionsOf(['1.0.0', '1.1.0-0', '1.1.0']);

    expect(listed).toEqual({ highest: '1.1.0', stable: '1.1.0' });
  });

  test('with nothing listed there is no highest and no stable version', () => {
    const listed = listedVersionsOf([]);

    expect(listed).toEqual({ highest: undefined, stable: undefined });
  });

  test('a version with a prerelease is not stable, whatever its build', () => {
    const listed = listedVersionsOf(['0.0.0-0', '2.1.0-alpha+build.5']);

    expect(listed.stable).toBeUndefined();
  });

  test('a hyphen in the build does not make a prerelease', () => {
    const listed = listedVersionsOf(['1.0.0+build-1']);

    expect(listed.stable).toBe('1.0.0+build-1');
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
  const { highest, stable } = listedVersionsOf(versions);
  const baseline = { version: highest!, stable, bump };
  return { baseline, versions, force, prerelease };
}

describe('derivedVersionOf', () => {
  test.for([
    ['only prereleases listed, whatever changed', '1.0.0', ['1.0.0-0', '1.0.0-1'], 'major'],
    ['only hand-numbered prereleases listed', '1.0.0', ['1.0.0-rc.1', '1.0.0-rc.2'], 'patch'],
    ['only a prerelease of 2.0.0 listed', '2.0.0', ['2.0.0-rc.1'], 'patch'],
    ['a prerelease above a stable version, a patch', '1.1.0', ['1.0.0', '1.1.0-0'], 'patch'],
    ['a prerelease above a stable version, a major', '2.0.0', ['1.0.0', '1.1.0-0'], 'major'],
    [
      'a prerelease above a stable version, nothing changed',
      '1.1.0',
      ['1.0.0', '1.1.0-0'],
      'unchanged',
    ],
    ['a stable version, a major', '2.0.0', ['1.4.7'], 'major'],
    ['a stable version, a minor', '1.5.0', ['1.4.7'], 'minor'],
    ['a stable version, a patch', '1.4.8', ['1.4.7'], 'patch'],
    ['version 0.0.0, a major', '1.0.0', ['0.0.0'], 'major'],
    ['version 0.9.9, a minor', '0.10.0', ['0.9.9'], 'minor'],
    ['version 0.0.9, a patch', '0.0.10', ['0.0.9'], 'patch'],
    ['a stable version with a build, a minor', '1.5.0', ['1.4.7+build.5'], 'minor'],
    [
      'a patch number beyond what a double holds',
      '1.0.9007199254740994',
      ['1.0.9007199254740993'],
      'patch',
    ],
    [
      'numbers that differ beyond what a double holds',
      '9007199254740993.0.0',
      ['9007199254740992.0.0', '9007199254740993.0.0-0'],
      'patch',
    ],
  ] as const)('with %s, publish takes the version %s', ([, version, versions, bump]) => {
    const derived = derivedVersionOf(derivingFrom(versions, bump));

    expect(derived).toMatchObject({ kind: 'version', version });
  });

  test.for([
    ['only prereleases listed, whatever changed', '1.0.0-2', ['1.0.0-0', '1.0.0-1'], 'major'],
    ['a prerelease above a stable version, a patch', '1.1.0-1', ['1.0.0', '1.1.0-0'], 'patch'],
    ['a prerelease above a stable version, a major', '2.0.0-0', ['1.0.0', '1.1.0-0'], 'major'],
    ['a stable version, a minor', '1.1.0-0', ['1.0.0'], 'minor'],
    [
      'prereleases of the same numbers, the counter is one above the highest',
      '1.1.0-13',
      ['1.0.0', '1.1.0-0', '1.1.0-2', '1.1.0-12'],
      'patch',
    ],
    [
      'a prerelease of other numbers, which is not counted',
      '1.1.0-1',
      ['1.0.0', '1.0.1-7', '1.1.0-0'],
      'patch',
    ],
    [
      'a counter beyond what a double holds',
      '1.0.0-9007199254740994',
      ['1.0.0-9007199254740993'],
      'patch',
    ],
    ['a counter whose version has a build', '1.0.0-5', ['1.0.0-4+build.1'], 'patch'],
  ] as const)(
    'with %s, publish --prerelease takes the version %s',
    ([, version, versions, bump]) => {
      const derived = derivedVersionOf(derivingFrom(versions, bump, { prerelease: true }));

      expect(derived).toMatchObject({ kind: 'version', version });
    },
  );

  test.for([
    ['a hand-numbered prerelease', '1.1.0-0', ['1.0.0', '1.1.0-rc.1'], 'patch', false],
    ['hand-numbered prereleases', '1.0.0-0', ['1.0.0-rc.1', '1.0.0-rc.2'], 'minor', false],
    ['a prerelease of 2.0.0 named rc.1', '2.0.0-0', ['2.0.0-rc.1'], 'patch', false],
    ['a prerelease named beta', '1.0.1-0', ['1.0.0', '1.0.1-beta'], 'patch', false],
    ['a prerelease of two identifiers', '1.1.0-0', ['1.0.0', '1.1.0-0.1'], 'patch', false],
    [
      'a hand-numbered prerelease and --force',
      '1.1.0-0',
      ['1.0.0', '1.1.0-rc.1'],
      'unchanged',
      true,
    ],
  ] as const)(
    'with %s listed, publish --prerelease would take %s, which is not above the Baseline',
    ([, version, versions, bump, force]) => {
      const derived = derivedVersionOf(derivingFrom(versions, bump, { force, prerelease: true }));

      expect(derived).toEqual({ kind: 'not-above', version, baseline: versions.at(-1) });
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

describe('derivedVersionOf, why it takes the version', () => {
  test.for([
    ['a package with no Baseline', { kind: 'first-version' }, undefined],
    ['a major against a stable Baseline', { kind: 'bump', bump: 'major' }, ['1.4.7'], 'major'],
    [
      'a patch against a prerelease Baseline',
      { kind: 'bump', bump: 'patch' },
      ['1.0.0-0'],
      'patch',
    ],
  ] as const)('with %s, it is the %o', ([, why, versions, bump]) => {
    const deriving =
      versions === undefined
        ? { baseline: undefined, versions: [], force: false, prerelease: false }
        : derivingFrom(versions, bump);

    expect(derivedVersionOf(deriving)).toMatchObject({ kind: 'version', why });
  });

  test('a prerelease Baseline with nothing changed is promoted', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '1.1.0-0'], 'unchanged'));

    expect(derived).toMatchObject({ why: { kind: 'promotes', baseline: '1.1.0-0' } });
  });

  test('--force does not stop a prerelease Baseline from being promoted', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0-0'], 'unchanged', { force: true }),
    );

    expect(derived).toMatchObject({ version: '1.1.0', why: { kind: 'promotes' } });
  });

  test('--force over an unchanged stable Baseline is forced', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0'], 'unchanged', { force: true }));

    expect(derived).toMatchObject({ version: '1.0.1', why: { kind: 'forced' } });
  });

  test('--force --prerelease over a prerelease Baseline is forced, never a promotion', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0-0'], 'unchanged', { force: true, prerelease: true }),
    );

    expect(derived).toMatchObject({
      version: '1.1.0-1',
      tag: 'next',
      why: { kind: 'forced' },
    });
  });
});
