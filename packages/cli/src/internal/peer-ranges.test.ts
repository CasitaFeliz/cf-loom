import { semanticVersionPartsOf, zodPeerRange } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { peerRangesOf } from './index.ts';

const contract = '@cf-loom/contract';

describe('peerRangesOf', () => {
  test.each([
    { cli: '1.4.2', range: '^1.4.0' },
    { cli: '1.0.0', range: '^1.0.0' },
    { cli: '1.0.0-rc.0', range: '^1.0.0-rc.0' },
    { cli: '0.3.1', range: '^0.3.0' },
    { cli: '0.0.3', range: '^0.0.3' },
    { cli: '0.0.0', range: '^0.0.0' },
  ])('the CLI $cli declares @cf-loom/contract as $range', ({ cli, range }) => {
    const ranges = peerRangesOf(cli);

    expect(ranges[contract]).toBe(range);
  });

  test('zod is the range @cf-loom/contract declares, whichever CLI publishes', () => {
    const ranges = [peerRangesOf('1.4.2'), peerRangesOf('0.0.1'), peerRangesOf('2.0.0-rc.1')];

    expect(ranges.map((peers) => peers['zod'])).toEqual([zodPeerRange, zodPeerRange, zodPeerRange]);
  });

  test('a package declares those two peers and no other', () => {
    const ranges = peerRangesOf('1.4.2');

    expect(Object.keys(ranges).sort()).toEqual([contract, 'zod']);
  });
});

/** The part of a version a caret on it keeps fixed, as npm reads `^`: its major, else `0.minor`, else `0.0.patch`. */
function lineOf(version: string): string {
  const [major, minor, patch] = semanticVersionPartsOf(version).core;
  if (major !== '0') {
    return major;
  }
  return minor === '0' ? `0.0.${patch}` : `0.${minor}`;
}

/** Whether a version is one a caret range admits: its line, from its floor up, prereleases only as the floor itself. */
function admits(caret: string, version: string): boolean {
  const floor = caret.slice(1);
  if (floor === version) {
    return true;
  }
  const { core, prerelease } = semanticVersionPartsOf(version);
  const floorCore = semanticVersionPartsOf(floor).core;
  const isFromFloor = core.map(BigInt).every((number, at) => number >= BigInt(floorCore[at] ?? 0));
  return prerelease.length === 0 && lineOf(version) === lineOf(floor) && isFromFloor;
}

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Versions of every shape a CLI may have: `M.m.p`, `0.m.p`, `0.0.p` and with a prerelease. */
function versionsOfEveryShape(): readonly string[] {
  const numbers = [0, 1, 2, 9, 10, 123];
  const cores = numbers.flatMap((major) =>
    numbers.flatMap((minor) => numbers.map((patch) => `${major}.${minor}.${patch}`)),
  );
  const prereleases = ['rc.0', 'rc.12', '0', 'alpha', 'alpha.1'];
  return [...cores, ...cores.flatMap((core) => prereleases.map((pre) => `${core}-${pre}`))];
}

describe('peerRangesOf, over every shape of version', () => {
  test('the @cf-loom/contract the CLI is released with always satisfies the range it writes', () => {
    const versions = versionsOfEveryShape();

    const unsatisfied = versions.filter(
      (version) => !admits(peerRangesOf(version)[contract] ?? '', version),
    );

    expect(unsatisfied).toEqual([]);
  });

  test('two CLI versions of one minor, neither a prerelease nor 0.0.x, write equal ranges', () => {
    const next = seededNext(213);
    const draw = (limit: number) => Math.floor(next() * limit);
    const pairs = Array.from({ length: 500 }, () => {
      const major = draw(5);
      const minor = major === 0 ? 1 + draw(40) : draw(40);
      return [`${major}.${minor}.${draw(1000)}`, `${major}.${minor}.${draw(1000)}`] as const;
    });

    const differing = pairs.filter(
      ([left, right]) => peerRangesOf(left)[contract] !== peerRangesOf(right)[contract],
    );

    expect(differing).toEqual([]);
  });

  test('two CLI versions of different minors write different ranges', () => {
    const ranges = ['1.4.2', '1.5.0', '2.4.2', '0.4.2', '0.5.2'].map(
      (version) => peerRangesOf(version)[contract],
    );

    expect(new Set(ranges).size).toBe(5);
  });
});
