import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { type PeerMove, peerMovesOf, versionBumpOf, zodPeerRange } from '../internal/index.ts';

function movesOf(baseline: Record<string, string>, proposed: Record<string, string>) {
  return peerMovesOf({ baseline, proposed });
}

describe('peerMovesOf', () => {
  test('a caret moving to a new line is a major move, with both ranges', () => {
    const moves = movesOf({ zod: '^4.1.0' }, { zod: '^5.0.0' });

    expect(moves).toEqual([{ name: 'zod', from: '^4.1.0', to: '^5.0.0', bump: 'major' }]);
  });

  test('a move within the line is a minor move', () => {
    const moves = movesOf({ zod: '^4.1.0' }, { zod: '^4.6.7' });

    expect(moves).toEqual([{ name: 'zod', from: '^4.1.0', to: '^4.6.7', bump: 'minor' }]);
  });

  test('a peer added is a minor move from nothing, and one dropped a minor move to nothing', () => {
    const added = movesOf({}, { zod: '^4.1.0' });
    const dropped = movesOf({ zod: '^4.1.0' }, {});

    expect([added, dropped]).toEqual([
      [{ name: 'zod', from: null, to: '^4.1.0', bump: 'minor' }],
      [{ name: 'zod', from: '^4.1.0', to: null, bump: 'minor' }],
    ]);
  });

  test('a range that is no caret moving is a major move, since no overlap can be proven', () => {
    const moves = movesOf({ zod: '>=4.1.0' }, { zod: '>=4.2.0' });

    expect(moves).toEqual([{ name: 'zod', from: '>=4.1.0', to: '>=4.2.0', bump: 'major' }]);
  });

  test('equal ranges move nothing', () => {
    const ranges = { zod: '^4.1.0', '@cf-loom/contract': '>=1.0.0' };

    const moves = movesOf(ranges, ranges);

    expect(moves).toEqual([]);
  });

  test('moves come by name in code point order', () => {
    const baseline = { zod: '^4.1.0', '@cf-loom/contract': '^1.0.0', b: '^1.0.0' };
    const proposed = { zod: '^4.2.0', '@cf-loom/contract': '^2.0.0', a: '^1.0.0' };

    const moves = movesOf(baseline, proposed);

    expect(moves.map(({ name }) => name)).toEqual(['@cf-loom/contract', 'a', 'b', 'zod']);
  });
});

describe('peerMovesOf and versionBumpOf agree', () => {
  const names = ['zod', '@cf-loom/contract', 'left', 'right'];
  const ranges = ['^4.1.0', '^4.6.7', '^5.0.0', '^0.1.0', '^0.2.0', '~4.1.0', '>=4.1.0', '^4.1'];

  function randomRanges(next: () => number): Record<string, string> {
    const held = names.filter(() => next() < 0.6);
    const draws = held.map((name) => [
      name,
      ranges[Math.floor(next() * ranges.length)] ?? '^4.1.0',
    ]);
    return Object.fromEntries(draws);
  }

  test('the bump is the highest of the moves, and none when nothing moved, over random ranges', () => {
    const next = seededNext(165);
    const draws = Array.from(
      { length: 500 },
      (): PeerMove => ({
        baseline: randomRanges(next),
        proposed: randomRanges(next),
      }),
    );

    const bumps = draws.map((peers) => versionBumpOf({ changes: [] }, peers));

    const highest = draws.map((peers) => {
      const moves = peerMovesOf(peers).map(({ bump }) => bump);
      if (moves.includes('major')) {
        return 'major';
      }
      return moves.includes('minor') ? 'minor' : 'unchanged';
    });
    expect(bumps).toEqual(highest);
  });

  test('equal ranges give no move, over random ranges', () => {
    const next = seededNext(166);
    const draws = Array.from({ length: 200 }, () => randomRanges(next));

    const moves = draws.map((held) => peerMovesOf({ baseline: held, proposed: { ...held } }));

    expect(moves.flat()).toEqual([]);
  });
});

describe('zodPeerRange', () => {
  test('is the range of zod the workspace declares, which @cf-loom/contract peers on', () => {
    const workspace = readFileSync(
      new URL('../../../../pnpm-workspace.yaml', import.meta.url),
      'utf8',
    );

    const declared = /^ {2}zod: (\S+)$/m.exec(workspace)?.[1];

    expect(zodPeerRange).toBe(declared);
  });
});
