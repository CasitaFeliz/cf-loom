import { describe, expect, test } from 'vitest';
import {
  baselineCandidatesOf,
  type Derived,
  type Deriving,
  derivedVersionOf,
  listedVersionsOf,
} from './index.ts';

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

describe('baselineCandidatesOf', () => {
  test('the versions that are not prereleases come first, highest first, then the prereleases, highest first', () => {
    const listed = ['1.0.0-0', '1.0.0', '1.1.0-0', '1.1.0', '2.0.0-rc.1'];

    const candidates = baselineCandidatesOf(listed);

    expect(candidates).toEqual(['1.1.0', '1.0.0', '2.0.0-rc.1', '1.1.0-0', '1.0.0-0']);
  });

  test('with nothing listed there is no candidate', () => {
    const candidates = baselineCandidatesOf([]);

    expect(candidates).toEqual([]);
  });
});

type Bump = 'unchanged' | 'patch' | 'minor' | 'major';

type Derivation = {
  readonly force?: boolean;
  readonly prerelease?: boolean;
  /** The Baseline when it is not the first candidate: a higher version cf-loom did not publish is listed. */
  readonly baseline?: string;
};

/** What `publish` derives from, with these versions listed lowest first and all published by cf-loom, changes of this size against the Baseline and these options. */
function derivingFrom(versions: readonly string[], bump: Bump, options: Derivation = {}): Deriving {
  const { force = false, prerelease = false } = options;
  const [first = ''] = baselineCandidatesOf(versions);
  const baseline = { version: options.baseline ?? first, bump };
  return { baseline, versions, force, prerelease };
}

/** What `publish` derives for a package with no Baseline that lists these versions, none published by cf-loom. */
function derivingWithNoBaseline(versions: readonly string[], options: Derivation = {}): Deriving {
  const { force = false, prerelease = false } = options;
  return { baseline: undefined, versions, force, prerelease };
}

describe('derivedVersionOf', () => {
  test.for([
    ['only prereleases listed, whatever changed', '1.0.0', ['1.0.0-0', '1.0.0-1'], 'major'],
    ['only hand-numbered prereleases listed', '1.0.0', ['1.0.0-rc.1', '1.0.0-rc.2'], 'patch'],
    ['only a prerelease of 2.0.0 listed', '2.0.0', ['2.0.0-rc.1'], 'patch'],
    [
      'a prerelease listed above a stable Baseline, a patch',
      '1.0.1',
      ['1.0.0', '2.0.0-0'],
      'patch',
    ],
    [
      'a prerelease listed above a stable Baseline, a major',
      '2.0.0',
      ['1.0.0', '1.1.0-0'],
      'major',
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
      ['9007199254740992.0.0-0', '9007199254740993.0.0-0'],
      'patch',
    ],
  ] as const)('with %s, publish takes the version %s', ([, version, versions, bump]) => {
    const derived = derivedVersionOf(derivingFrom(versions, bump));

    expect(derived).toMatchObject({ kind: 'version', version });
  });

  test.for([
    ['only prereleases listed, whatever changed', '1.0.0-2', ['1.0.0-0', '1.0.0-1'], 'major'],
    [
      'a prerelease listed above a stable Baseline, a patch',
      '1.0.1-0',
      ['1.0.0', '1.1.0-0'],
      'patch',
    ],
    [
      'a prerelease listed above a stable Baseline, a minor',
      '1.1.0-1',
      ['1.0.0', '1.1.0-0'],
      'minor',
    ],
    [
      'a prerelease listed above a stable Baseline, a major',
      '2.0.0-0',
      ['1.0.0', '1.1.0-0'],
      'major',
    ],
    ['a stable version, a minor', '1.1.0-0', ['1.0.0'], 'minor'],
    [
      'prereleases of the same numbers, the counter is one above the highest',
      '1.1.0-13',
      ['1.0.0', '1.1.0-0', '1.1.0-2', '1.1.0-12'],
      'minor',
    ],
    [
      'a prerelease of other numbers, which is not counted',
      '1.1.0-1',
      ['1.0.0', '1.0.1-7', '1.1.0-0'],
      'minor',
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
    ['a hand-numbered prerelease', '1.1.0-0', ['1.1.0-rc.1'], 'patch', false],
    ['hand-numbered prereleases', '1.0.0-0', ['1.0.0-rc.1', '1.0.0-rc.2'], 'minor', false],
    ['a prerelease of 2.0.0 named rc.1', '2.0.0-0', ['2.0.0-rc.1'], 'patch', false],
    ['a prerelease named beta', '1.0.1-0', ['1.0.1-beta'], 'patch', false],
    ['a prerelease of two identifiers', '1.1.0-0', ['1.1.0-0.1'], 'patch', false],
    ['a hand-numbered prerelease and --force', '1.1.0-0', ['1.1.0-rc.1'], 'unchanged', true],
  ] as const)(
    'with %s listed, publish --prerelease would take %s, which is not above the Baseline',
    ([, version, versions, bump, force]) => {
      const derived = derivedVersionOf(derivingFrom(versions, bump, { force, prerelease: true }));

      expect(derived).toEqual({ kind: 'not-above', version, baseline: versions.at(-1) });
    },
  );

  test('a prerelease listed above a stable Baseline is no floor for the version of a patch', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '2.0.0-0'], 'patch'));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.1', tag: 'latest' });
  });

  test('nothing changed over a stable Baseline with a prerelease listed above it is nothing to publish', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '2.0.0-0'], 'unchanged'));

    expect(derived).toEqual({ kind: 'unchanged', baseline: '1.0.0' });
  });

  test('a package never published takes 1.0.0', () => {
    const derived = derivedVersionOf(derivingWithNoBaseline([]));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0' });
  });

  test('a package never published takes 1.0.0-0 with --prerelease', () => {
    const derived = derivedVersionOf(derivingWithNoBaseline([], { prerelease: true }));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-0' });
  });

  test.for([
    ['a placeholder 0.0.0', '1.0.0', ['0.0.0']],
    ['versions 1.0.0, 2.0.0 and 3.2.0', '4.0.0', ['1.0.0', '2.0.0', '3.2.0']],
    ['a version 3.2.0 and a prerelease of 5.0.0', '4.0.0', ['3.2.0', '5.0.0-rc.1']],
    ['only a prerelease of 3.0.0', '1.0.0', ['3.0.0-rc.1']],
  ] as const)(
    'with %s listed and none published by cf-loom, the first version is %s',
    ([, version, versions]) => {
      const derived = derivedVersionOf(derivingWithNoBaseline(versions));

      expect(derived).toMatchObject({ kind: 'version', version, why: { kind: 'first-version' } });
    },
  );

  test.for([
    ['a patch', 'patch', '2.0.0'],
    ['a minor', 'minor', '2.0.0'],
  ] as const)(
    'with a stable version cf-loom did not publish above the Baseline, %s publishes the major above it',
    ([, bump, version]) => {
      const derived = derivedVersionOf(
        derivingFrom(['1.0.0', '1.0.1'], bump, { baseline: '1.0.0' }),
      );

      const why = { kind: 'above-unchecked', version: '1.0.1' };
      expect(derived).toMatchObject({ kind: 'version', version, why });
    },
  );

  test('a Breaking Change gives the major above the Baseline when that is also above the version cf-loom did not publish', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.0.1'], 'major', { baseline: '1.0.0' }),
    );

    expect(derived).toMatchObject({ version: '2.0.0', why: { kind: 'bump', bump: 'major' } });
  });

  test('a Breaking Change gives the major above a version cf-loom did not publish when that is higher', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '2.1.0'], 'major', { baseline: '1.0.0' }),
    );

    const why = { kind: 'above-unchecked', version: '2.1.0' };
    expect(derived).toMatchObject({ version: '3.0.0', why });
  });

  test('nothing changed over a stable Baseline with a version cf-loom did not publish above it is nothing to publish', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.0.1'], 'unchanged', { baseline: '1.0.0' }),
    );

    expect(derived).toEqual({ kind: 'unchanged', baseline: '1.0.0' });
  });

  test('--force over a stable Baseline with a version cf-loom did not publish above it publishes the major above that version', () => {
    const forcing = { baseline: '1.0.0', force: true };

    const derived = derivedVersionOf(derivingFrom(['1.0.0', '1.0.1'], 'unchanged', forcing));

    expect(derived).toMatchObject({ kind: 'version', version: '2.0.0' });
  });

  test('a prerelease Baseline below 1.0.0 is promoted to 1.0.0 when nothing changed', () => {
    const derived = derivedVersionOf(derivingFrom(['0.1.0-0'], 'unchanged'));

    expect(derived).toMatchObject({
      version: '1.0.0',
      why: { kind: 'promotes', baseline: '0.1.0-0' },
    });
  });

  test('a prerelease Baseline above a version cf-loom did not publish is promoted when nothing changed', () => {
    const derived = derivedVersionOf(
      derivingFrom(['3.2.0', '4.0.0-0'], 'unchanged', { baseline: '4.0.0-0' }),
    );

    expect(derived).toMatchObject({
      version: '4.0.0',
      why: { kind: 'promotes', baseline: '4.0.0-0' },
    });
  });

  test('a prerelease Baseline below a version cf-loom did not publish is promoted to the major above that version', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0-0', '1.0.0'], 'unchanged', { baseline: '1.0.0-0' }),
    );

    const why = { kind: 'above-unchecked', version: '1.0.0' };
    expect(derived).toMatchObject({ version: '2.0.0', why });
  });

  test('nothing changed over a prerelease Baseline with nothing else listed promotes it', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0-0', '1.0.0-1'], 'unchanged'));

    expect(derived).toMatchObject({
      version: '1.0.0',
      why: { kind: 'promotes', baseline: '1.0.0-1' },
    });
  });

  test('nothing changed over a prerelease Baseline publishes nothing with --prerelease', () => {
    const derived = derivedVersionOf(derivingFrom(['1.1.0-0'], 'unchanged', { prerelease: true }));

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
});

describe('derivedVersionOf, the dist-tag', () => {
  test('a version that is not a prerelease takes the latest dist-tag', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0', '1.1.0-0'], 'patch'));

    expect(derived).toMatchObject({ kind: 'version', tag: 'latest' });
  });

  test('a first prerelease takes the latest dist-tag with nothing listed', () => {
    const derived = derivedVersionOf(derivingWithNoBaseline([], { prerelease: true }));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-0', tag: 'latest' });
  });

  test('a first prerelease takes the latest dist-tag with a placeholder listed', () => {
    const derived = derivedVersionOf(derivingWithNoBaseline(['0.0.0'], { prerelease: true }));

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-0', tag: 'latest' });
  });

  test('a second prerelease over a placeholder takes the tag the first took', () => {
    const versions = ['0.0.0', '1.0.0-0'];

    const derived = derivedVersionOf(
      derivingFrom(versions, 'patch', { prerelease: true, baseline: '1.0.0-0' }),
    );

    expect(derived).toMatchObject({ kind: 'version', version: '1.0.0-1', tag: 'latest' });
  });

  test('a prerelease takes the latest dist-tag while cf-loom published no version that is not one', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0-0', '1.0.0-1'], 'patch', { prerelease: true }),
    );

    expect(derived).toMatchObject({ kind: 'version', tag: 'latest' });
  });

  test('a prerelease takes the next dist-tag once cf-loom published a version that is not one', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.1.0-0'], 'patch', { prerelease: true }),
    );

    expect(derived).toMatchObject({ kind: 'version', tag: 'next' });
  });

  test('a prerelease over a stable Baseline takes the next dist-tag, a version cf-loom did not publish above it included', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.0.0', '1.0.1'], 'patch', { prerelease: true, baseline: '1.0.0' }),
    );

    expect(derived).toMatchObject({ kind: 'version', version: '2.0.0-0', tag: 'next' });
  });

  test('a prerelease over versions cf-loom did not publish takes the latest dist-tag, whatever it is above', () => {
    const derived = derivedVersionOf(derivingWithNoBaseline(['3.2.0'], { prerelease: true }));

    expect(derived).toMatchObject({ kind: 'version', version: '4.0.0-0', tag: 'latest' });
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
      versions === undefined ? derivingWithNoBaseline([]) : derivingFrom(versions, bump);

    expect(derivedVersionOf(deriving)).toMatchObject({ kind: 'version', why });
  });

  test('a prerelease Baseline with nothing changed is promoted', () => {
    const derived = derivedVersionOf(derivingFrom(['1.1.0-0'], 'unchanged'));

    expect(derived).toMatchObject({ why: { kind: 'promotes', baseline: '1.1.0-0' } });
  });

  test('--force does not stop a prerelease Baseline from being promoted', () => {
    const derived = derivedVersionOf(derivingFrom(['1.1.0-0'], 'unchanged', { force: true }));

    expect(derived).toMatchObject({ version: '1.1.0', why: { kind: 'promotes' } });
  });

  test('--force over an unchanged stable Baseline is forced', () => {
    const derived = derivedVersionOf(derivingFrom(['1.0.0'], 'unchanged', { force: true }));

    expect(derived).toMatchObject({ version: '1.0.1', why: { kind: 'forced' } });
  });

  test('--force --prerelease over a prerelease Baseline is forced, never a promotion', () => {
    const derived = derivedVersionOf(
      derivingFrom(['1.1.0-0'], 'unchanged', { force: true, prerelease: true }),
    );

    expect(derived).toMatchObject({
      version: '1.1.0-1',
      tag: 'latest',
      why: { kind: 'forced' },
    });
  });
});

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Versions in semantic order, lowest first, which a draw lists some of. */
const pool: readonly string[] = [
  '0.0.0',
  '0.1.0-0',
  '1.0.0-0',
  '1.0.0-rc.1',
  '1.0.0',
  '1.0.1',
  '1.1.0-0',
  '1.1.0-3',
  '1.1.0',
  '2.0.0-0',
  '2.0.0',
  '3.2.0',
  '4.0.0-0',
  '4.0.0',
  '10.0.0',
];

const bumps: readonly Bump[] = ['unchanged', 'patch', 'minor', 'major'];

type Draw = {
  readonly versions: readonly string[];
  readonly baseline: string | undefined;
  readonly bump: Bump;
  readonly force: boolean;
  readonly prerelease: boolean;
};

/** A draw of listed versions, which of them cf-loom published, and what is asked of `publish`. */
function drawFrom(next: () => number): Draw {
  const versions = pool.filter(() => next() < 0.35);
  const published = versions.filter(() => next() < 0.5);
  const baseline = baselineCandidatesOf(versions).find((version) => published.includes(version));
  const bump = bumps[Math.floor(next() * bumps.length)] ?? 'patch';
  return { versions, baseline, bump, force: next() < 0.3, prerelease: next() < 0.5 };
}

function derivingOf({ versions, baseline, bump, force, prerelease }: Draw): Deriving {
  return {
    baseline: baseline === undefined ? undefined : { version: baseline, bump },
    versions,
    force,
    prerelease,
  };
}

function numbersOf(version: string): readonly number[] {
  return (version.split('-')[0] ?? '').split('.').map(Number);
}

function isAbove(version: string, other: string): boolean {
  const [left, right] = [numbersOf(version), numbersOf(other)];
  const differing = left.findIndex((number, index) => number !== right[index]);
  return differing !== -1 && (left[differing] ?? 0) > (right[differing] ?? 0);
}

function isPrereleaseVersion(version: string): boolean {
  return version.includes('-');
}

/** The `<n>` of a prerelease `<numbers>-<n>`, when it is digits only; an identifier with a letter sorts above every number. */
function counterOf(version: string): number | undefined {
  const identifier = version.split('-')[1] ?? '';
  return /^\d+$/.test(identifier) ? Number(identifier) : undefined;
}

/** Whether a version is above the Baseline: higher numbers, or the same numbers as a version that is not a prerelease over a prerelease, or as a higher counter. */
function isAboveBaseline(version: string, baseline: string): boolean {
  if (isAbove(version, baseline)) {
    return true;
  }
  if (numbersOf(version).join() !== numbersOf(baseline).join()) {
    return false;
  }
  if (!isPrereleaseVersion(version)) {
    return isPrereleaseVersion(baseline);
  }
  const [counter, baselineCounter] = [counterOf(version), counterOf(baseline)];
  return counter !== undefined && baselineCounter !== undefined && counter > baselineCounter;
}

/** What a derivation of a draw breaks: nothing published over a Baseline that changed, not-above over a Baseline that is no prerelease, or a version that is listed, not above a stable one or not above the Baseline. */
function brokenBy({ baseline, versions }: Draw, derived: Derived): readonly string[] {
  switch (derived.kind) {
    case 'unchanged':
      return derived.baseline === baseline ? [] : ['it names another Baseline'];
    case 'not-above':
      return baseline !== undefined && isPrereleaseVersion(baseline)
        ? []
        : ['the Baseline is none'];
    case 'version': {
      const stable = versions.filter((version) => !isPrereleaseVersion(version));
      const below = stable.filter((version) => !isAbove(derived.version, version));
      const listed = versions.includes(derived.version) ? ['it is listed'] : [];
      const notAbove =
        baseline !== undefined && !isAboveBaseline(derived.version, baseline)
          ? [`it is not above the Baseline ${baseline}`]
          : [];
      return [...listed, ...below.map((version) => `it is not above ${version}`), ...notAbove];
    }
  }
}

describe('derivedVersionOf, for any listed versions and any Baseline among them', () => {
  test('a derived version is not listed and is above the Baseline and every version that is not a prerelease, or nothing is published', () => {
    const next = seededNext(325);
    const broken: string[] = [];

    for (let draw = 0; draw < 3000; draw += 1) {
      const drawn = drawFrom(next);
      const derived = derivedVersionOf(derivingOf(drawn));

      for (const reason of brokenBy(drawn, derived)) {
        broken.push(
          `${drawn.versions} over ${drawn.baseline}: ${JSON.stringify(derived)}: ${reason}`,
        );
      }
    }

    expect(broken).toEqual([]);
  });
});
