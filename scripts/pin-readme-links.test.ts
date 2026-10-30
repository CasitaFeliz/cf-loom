import { describe, expect, it } from 'vitest';
import { pinnedReadme } from './pin-readme-links.ts';

const repository = 'CasitaFeliz/cf-loom';
const commit = '0123456789abcdef0123456789abcdef01234567';
const atMain = `https://github.com/${repository}/blob/main`;
const atCommit = `https://github.com/${repository}/blob/${commit}`;

describe('pinnedReadme', () => {
  it('points a link to a repository file at main at the commit, keeping its path and anchor', () => {
    const readme = `See [the rule](${atMain}/COMPATIBILITY.md#not-allowed-in-a-contract).`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toBe(`See [the rule](${atCommit}/COMPATIBILITY.md#not-allowed-in-a-contract).`);
  });
});
