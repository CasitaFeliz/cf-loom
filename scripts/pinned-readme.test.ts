import { Lexer, marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { tokenTypes } from './markdown-containers.ts';
import type { ReadmeProblem } from './pinned-readme.ts';
import { pinnedReadme } from './pinned-readme.ts';
import { aSeededDraw, pickFrom } from './seeded-draw.ts';

const repository = 'CasitaFeliz/cf-loom';
const commit = '0123456789abcdef0123456789abcdef01234567';
const atMain = `https://github.com/${repository}/blob/main`;
const atCommit = `https://github.com/${repository}/blob/${commit}`;

function refusedLinesOf(readme: string): number[] {
  const pinned = pinnedReadme(readme, repository, commit);
  const lines = pinned.kind === 'refused' ? pinned.problems.map(({ line }) => line) : [];
  return [...new Set(lines)];
}

function afterOnePinnedLink(form: string): string {
  return [`[ok](${atMain}/CONTEXT.md)`, '', form].join('\n');
}

describe('pinnedReadme', () => {
  it('points a link to a repository file at main at the commit, keeping its path and anchor', () => {
    const readme = `See [the rule](${atMain}/COMPATIBILITY.md#not-allowed-in-a-contract).`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: `See [the rule](${atCommit}/COMPATIBILITY.md#not-allowed-in-a-contract).`,
    });
  });

  it('pins every such link of a README, several on one line, one in a code block and one in a comment', () => {
    const readme = [
      `[one](${atMain}/CONTEXT.md) and [two](${atMain}/COMPATIBILITY.md#rules), [three](${atMain}/SNAPSHOT.md)`,
      '',
      '```md',
      `[in a block](${atMain}/ARCHITECTURE.md#runtime)`,
      '```',
      '',
      `<!-- [in a comment](${atMain}/CONTEXT.md) -->`,
    ].join('\n');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: [
        `[one](${atCommit}/CONTEXT.md) and [two](${atCommit}/COMPATIBILITY.md#rules), [three](${atCommit}/SNAPSHOT.md)`,
        '',
        '```md',
        `[in a block](${atCommit}/ARCHITECTURE.md#runtime)`,
        '```',
        '',
        `<!-- [in a comment](${atCommit}/CONTEXT.md) -->`,
      ].join('\n'),
    });
  });

  it.each([
    ['an anchor link', '[x](#not-allowed-in-a-contract)'],
    [
      'a link to another host',
      '[names](https://fetch.spec.whatwg.org/#forbidden-request-header) and [docs](https://zod.dev/api)',
    ],
    ['a target with a scheme in any case', '[x](HTTPS://zod.dev)'],
    [
      'reference definitions with a scheme or an anchor',
      '[rule]: https://zod.dev/api\n[top]: #contents',
    ],
    ['an image with a scheme', '![badge](https://img.shields.io/npm/v/x.svg)'],
    [
      'a query with an ampersand that is no character reference',
      '[x](https://img.shields.io/x?a=1&b=2)',
    ],
    [
      'code that holds a link, href, src and data-href',
      '```ts\nconst a = x[0](y);\nlocation.href = next;\nconst src = file;\nconst b = <a data-href="./x">;\n```',
    ],
    ['a reference definition indented four spaces, which is code', 'text\n\n    [r]: ./x.md'],
    ['a tilde fence holding a relative link', '~~~md\n[x](./a.md)\n~~~'],
    [
      'a four-backtick fence holding a three-backtick one and a relative link',
      '````md\n```\n[x](./a.md)\n```\n````',
    ],
    ['a code span holding a relative link', 'call `f[0](./x)` or `[x](./a.md)` here'],
    ['placeholders and generics in code spans', 'Run `cf-loom <command>` with `Array<T>`.'],
    ['a less-than sign and a generic with a comma in prose', 'a < b, 1 <2 and Map<string, number>'],
    [
      'an HTML comment, a block, an inline one and one over several lines, holding a relative link',
      '<!-- [x](./a.md) -->\n\ntext <!-- [y](./b.md) --> more\n\n<!--\n[z](./c.md)\n-->',
    ],
    [
      'prose and code with no repository reference',
      'Run `cf-loom verify`.\n\n```ts\nconst a = pinned(1);\n```',
    ],
  ])('leaves %s as it is', (_name, readme) => {
    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({ kind: 'pinned', text: readme });
  });

  it('matches the repository literally, so its dot is no wildcard', () => {
    const own = pinnedReadme('[own](https://github.com/a.b/c/blob/main/x.md)', 'a.b/c', commit);
    const other = pinnedReadme('[other](https://github.com/axb/c/blob/main/x.md)', 'a.b/c', commit);

    expect(own).toEqual({
      kind: 'pinned',
      text: `[own](https://github.com/a.b/c/blob/${commit}/x.md)`,
    });
    expect(other).toEqual({
      kind: 'refused',
      problems: [{ line: 1, problem: expect.stringContaining('is on GitHub') }],
    });
  });

  it.each([
    ['a bare repository link', `[x](https://github.com/${repository}#readme)`],
    ['blob/main with no path', `[x](https://github.com/${repository}/blob/main)`],
    ['blob/main/ with an empty path', `[x](${atMain}/)`],
    ['tree/main with no path', `[x](https://github.com/${repository}/tree/main)`],
    ['tree/main with a path', `[x](https://github.com/${repository}/tree/main/packages)`],
    [
      'another case of the repository',
      `[x](https://github.com/casitafeliz/cf-loom/blob/main/CONTEXT.md)`,
    ],
    ['blob/HEAD', `[x](https://github.com/${repository}/blob/HEAD/CONTEXT.md)`],
    ['http instead of https', `[x](http://github.com/${repository}/blob/main/CONTEXT.md)`],
    ['www.github.com', `[x](https://www.github.com/${repository}/blob/main/CONTEXT.md)`],
    [
      'raw.githubusercontent.com',
      `[x](https://raw.githubusercontent.com/${repository}/main/CONTEXT.md)`,
    ],
    ['a link target with a title', `[x](${atMain}/CONTEXT.md "the glossary")`],
    ['an autolink', `<${atMain}/CONTEXT.md>`],
    ['a bare URL', `See ${atMain}/CONTEXT.md now`],
    ['a reference definition at main', `[rule]: ${atMain}/CONTEXT.md`],
    ['the repository named in prose', `The documents of ${repository} are on GitHub.`],
    [
      'a backslash-escaped hyphen in the repository, which the text does not show',
      '[x](https://github.com/CasitaFeliz/cf\\-loom/blob/main/a.md)',
    ],
    [
      'a backslash-escaped slash in the repository',
      '[x](https://github.com/CasitaFeliz\\/cf-loom/blob/main/a.md)',
    ],
    [
      'an image of an escaped repository',
      '![x](https://github.com/CasitaFeliz/cf\\-loom/blob/main/a.png)',
    ],
    [
      'a definition of an escaped repository',
      '[r]: https://github.com/CasitaFeliz/cf\\-loom/blob/main/a.md',
    ],
  ])('refuses %s, naming its line', (_form, offending) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual([3]);
  });

  it.each([
    ['a relative link up', '[x](../../COMPATIBILITY.md)', [3]],
    ['a relative link here', '[x](./COMPATIBILITY.md)', [3]],
    ['a relative link by name', '[x](COMPATIBILITY.md#rules)', [3]],
    ['a relative link target with a title', '[x](../a.md "the rule")', [3]],
    ['a relative target in angle brackets with a space', '[x](<../a b.md>)', [3]],
    ['a relative target with an escaped parenthesis', '[x](../a\\).md)', [3]],
    ['an empty target', '[x]()', [3]],
    ['a protocol-relative target', '[x](//github.com/a/b)', [3]],
    ['a relative target on the line after its link starts', '[x](\n../a.md)', [3]],
    ['a relative image', '![x](./diagram.png)', [3]],
    ['a relative reference definition', '[rule]: ../../COMPATIBILITY.md#rules', [3]],
    ['a relative reference definition in angle brackets', '  [rule]: <./COMPATIBILITY.md>', [3]],
    [
      'a relative reference definition whose target is on the next line',
      '[rule]:\n  ../../COMPATIBILITY.md',
      [3],
    ],
    ['a relative link through its definition', '[x][rule]\n\n[rule]: ../a.md', [3, 5]],
    ['a footnote definition that is a relative target', '[^1]: ../a.md', [3]],
    ['a relative link in a footnote text', 'a[^1]\n\n[^1]: see [y](../a.md)', [5]],
    ['a relative link in a list item', '- one\n- two [x](./l.md)', [4]],
    ['a relative link on the second line of a blockquote', '> one\n> two [x](./q.md)', [4]],
    ['a relative link in a table cell', '| a |\n|---|\n| [x](./t.md) |', [5]],
    ['a relative link in a heading', '## [x](./h.md)', [3]],
    ['a relative link in strong text', '**[x](./s.md)**', [3]],
    ['a relative link around an image', '[![a](https://x.io/a.png)](./b.md)', [3]],
    ['a relative link after a code span', 'a `[x](./a.md)`\n[x](./a.md)', [4]],
    [
      'a quoted paragraph whose text appears again later',
      '> see\n> [x](./a.md)\n\nsee\n[x](./a.md)',
      [4, 7],
    ],
    [
      'a list item paragraph whose text appears again later',
      '- a\n  [x](./a.md)\n\na\n[x](./a.md)',
      [4, 7],
    ],
    [
      'a link split inside a blockquote, then the same link split outside it',
      '> [x](\n> ../a.md)\n\n[x](\n../a.md)',
      [3, 6],
    ],
    [
      'a link split inside a list item, then the same link split outside it',
      '- [x](\n  ../a.md)\n\n[x](\n../a.md)',
      [3, 6],
    ],
    [
      'a list in a blockquote whose text appears again later',
      '> - a\n>   [x](./a.md)\n\n- a\n  [x](./a.md)',
      [4, 7],
    ],
    ['a backslash-escaped repository in a code span', '`CasitaFeliz\\/cf-loom`', [3]],
    ['a backslash-escaped repository in a fence', '```md\nCasitaFeliz\\/cf-loom\n```', [4]],
  ])('refuses %s, naming the line where it starts', (_form, offending, lines) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual(lines);
  });

  it.each([
    [
      'a hexadecimal reference in the repository',
      '[x](https://github.com/CasitaFeliz&#x2F;cf-loom/blob/main/a.md)',
      [3],
    ],
    [
      'a decimal reference in the repository, in an image',
      '![x](https://github.com/CasitaFeliz&#47;cf-loom/blob/main/a.png)',
      [3],
    ],
    [
      'a named reference in the repository, in a definition',
      '[x][r]\n\n[r]: https://github.com/CasitaFeliz&sol;cf-loom/blob/main/a.md',
      [3, 5],
    ],
    ['a colon written as a reference', '[x](https&#58;//zod.dev)', [3]],
    ['dots written as references, which make a relative target', '[x](&#46;&#46;/a.md)', [3]],
    ['an ampersand written as a reference', '[x](https://zod.dev/a&amp;b)', [3]],
  ])('refuses a target with %s, naming its line', (_form, offending, lines) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual(lines);
  });

  it('names the character reference it refuses, which a browser decodes and the parser does not', () => {
    const pinned = pinnedReadme('[x](https&#58;//zod.dev)', repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [{ line: 1, problem: expect.stringMatching(/character reference &#58;/) }],
    });
  });

  it.each([
    ['an HTML link with a scheme', '<a href="https://fetch.spec.whatwg.org/">x</a>', [3]],
    ['a relative HTML href', '<a href="../../COMPATIBILITY.md">x</a>', [3]],
    ['a relative HTML src', "<img alt='' src='./diagram.png'>", [3]],
    ['an HTML srcset', '<img srcset="./a.png 2x">', [3]],
    ['a data attribute', '<a data-href="./x">y</a>', [3]],
    ['an inline tag in prose', 'a <b>bold</b> c', [3]],
    ['a generic type in prose', 'Use Array<T> here', [3]],
    ['a div block', '<div>\nhello\n</div>', [3]],
    ['a div block around Markdown', '<div>\n\n[x](./d.md)\n\n</div>', [3, 5, 7]],
    ['a comment followed by a tag on its line', '<!-- c --> <img src="https://x.io/a.png">', [3]],
    ['an empty comment <!--> before a tag', '<!--> <img src="./x"> -->', [3]],
    ['an empty comment <!---> before a tag', '<!---> <img src="./x"> -->', [3]],
    ['a comment that --!> ends before a tag', '<!-- c --!> <img src="./x"> -->', [3]],
  ])('refuses raw HTML as %s, naming its line', (_form, offending, lines) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual(lines);
  });

  it('pins a link whose path holds parentheses', () => {
    const readme = `[x](${atMain}/a(b).md)`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({ kind: 'pinned', text: `[x](${atCommit}/a(b).md)` });
  });

  it('pins a link whose path holds a fragment, and leaves the fragment as it is', () => {
    const readme = `[x](${atMain}/a.md#L10-L20)`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({ kind: 'pinned', text: `[x](${atCommit}/a.md#L10-L20)` });
  });

  it('pins a link whose fragment holds what its path may not: a question mark, a percent-escape and dots', () => {
    const readme = `[x](${atMain}/a.md#x?y%20z/../w)`;

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({ kind: 'pinned', text: `[x](${atCommit}/a.md#x?y%20z/../w)` });
  });

  it.each([
    [
      'a percent-escaped letter in the name',
      `https://github.com/CasitaFeliz/cf%2Dloom/blob/main/a.md`,
    ],
    ['a doubled slash', `https://github.com/CasitaFeliz//cf-loom/blob/main/a.md`],
    ['a dot segment before the name', `https://github.com/CasitaFeliz/x/../cf-loom/blob/main/a.md`],
  ])('refuses a link to the repository with %s, naming its line', (_form, target) => {
    const refused = refusedLinesOf(afterOnePinnedLink(`[x](${target})`));

    expect(refused).toEqual([3]);
  });

  it.each([
    ['dot segments', `${atMain}/../../../../${repository}/blob/main/a.md`],
    [
      'percent-escaped dot segments',
      `${atMain}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/${repository}/blob/main/a.md`,
    ],
    ['a dot segment among others', `${atMain}/a/./b.md`],
    ['an empty segment', `${atMain}/a//b.md`],
  ])('refuses a link at main whose path holds %s, naming its line', (_form, target) => {
    const refused = refusedLinesOf(afterOnePinnedLink(`[x](${target})`));

    expect(refused).toEqual([3]);
  });

  it('refuses a link written with backslashes in place of slashes', () => {
    const readme = afterOnePinnedLink(
      '[x](https:\\\\github.com\\CasitaFeliz\\cf-loom\\tree\\main)',
    );

    const refused = refusedLinesOf(readme);

    expect(refused).toEqual([3]);
  });

  it.each([
    ['plainly', `https://github.dev/${repository}/blob/main/a.md`],
    ['with an escaped hyphen', 'https://github.dev/CasitaFeliz/cf%2Dloom/blob/main/a.md'],
    ['to another repository', 'https://github.dev/other/repo/blob/main/a.md'],
  ])('refuses a github.dev link written %s, naming its line', (_form, target) => {
    const refused = refusedLinesOf(afterOnePinnedLink(`[x](${target})`));

    expect(refused).toEqual([3]);
  });

  it.each([
    ['an escaped slash and dots after the commit', `${atMain}/%2F..%2Fa.md`],
    ['a query', `${atMain}/a.md?plain=1`],
    ['a percent-escape in a segment', `${atMain}/a%20b.md`],
    ['a backslash in a segment', `${atMain}/a\\\\b.md`],
  ])('refuses a link of the pinned form with %s, naming its line', (_form, target) => {
    const refused = refusedLinesOf(afterOnePinnedLink(`[x](${target})`));

    expect(refused).toEqual([3]);
  });

  it.each([
    ['an upper-case host', 'HTTPS://GitHub.COM/other/repo/blob/main/a.md'],
    ['a trailing-dot host', 'https://github.com./other/repo/blob/main/a.md'],
    ['a port', 'https://github.com:8443/other/repo/blob/main/a.md'],
    ['userinfo', 'https://user@github.com/other/repo/blob/main/a.md'],
    ['a percent-escaped host', 'https://git%68ub.com/other/repo/blob/main/a.md'],
    ['a port on the repository', `https://github.com:8443/${repository}/blob/main/a.md`],
    ['userinfo on the repository', `https://user@github.com/${repository}/blob/main/a.md`],
  ])('refuses a GitHub link with %s, naming its line', (_form, target) => {
    const refused = refusedLinesOf(afterOnePinnedLink(`[x](${target})`));

    expect(refused).toEqual([3]);
  });

  it.each([
    ['a link', (target: string) => `[x](${target})`],
    ['an image', (target: string) => `![x](${target})`],
    ['a definition', (target: string) => `[r]: ${target}`],
  ])(
    'refuses %s to another GitHub repository, at main or at a commit, naming its line',
    (_form, write) => {
      const targets = [
        'https://github.com/CasitaFeliz/other/blob/main/README.md',
        'https://github.com/CasitaFeliz/cf-loom-x/blob/main/README.md',
        'https://github.com/my-CasitaFeliz/cf-loom/blob/main/README.md',
        `https://github.com/CasitaFeliz/other/blob/${commit}/README.md`,
      ];

      const refused = targets.map((target) => refusedLinesOf(afterOnePinnedLink(write(target))));

      expect(refused).toEqual([[3], [3], [3], [3]]);
    },
  );

  it.each([
    ['raw.githubusercontent.com', 'https://raw.githubusercontent.com/other/repo/main/a.md'],
    ['a subdomain of githubusercontent.com', 'https://objects.githubusercontent.com/a.png'],
    ['gist.github.com', 'https://gist.github.com/other/1'],
    ['www.github.com', 'https://www.github.com/other/repo'],
    ['GitHub.COM', 'https://GitHub.COM/other/repo'],
    ['a bare URL on GitHub', 'See https://github.com/other/repo now'],
    ['an autolink on GitHub', '<https://github.com/other/repo>'],
  ])('refuses a link to %s, naming its line', (_form, target) => {
    const markdown = target.startsWith('http') ? `[x](${target})` : target;

    const refused = refusedLinesOf(afterOnePinnedLink(markdown));

    expect(refused).toEqual([3]);
  });

  it('refuses each use of a definition on GitHub off the pinned form, and the definition', () => {
    const readme = afterOnePinnedLink('[a][r]\n\n[b][r]\n\n[r]: https://github.com/other/repo');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        {
          line: 3,
          problem: expect.stringContaining('"https://github.com/other/repo" is on GitHub'),
        },
        {
          line: 5,
          problem: expect.stringContaining('"https://github.com/other/repo" is on GitHub'),
        },
        {
          line: 7,
          problem: expect.stringContaining('"https://github.com/other/repo" is on GitHub'),
        },
      ],
    });
  });

  it('names the form to write, with the repository at main, in the problem of a GitHub link', () => {
    const pinned = pinnedReadme('[x](https://github.com/other/repo)', repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        {
          line: 1,
          problem: [
            'the link target "https://github.com/other/repo" is on GitHub;',
            `a package README links GitHub only as [text](${atMain}/<path>),`,
            '<path> with no ".", ".." or empty segment and no %, \\, ? or whitespace',
          ].join(' '),
        },
      ],
    });
  });

  it.each([
    ['a link with a title', `[x](${atMain}/CONTEXT.md "the glossary")`],
    ['a definition', `[rule]: ${atMain}/CONTEXT.md`],
    ['an autolink', `<${atMain}/CONTEXT.md>`],
  ])(
    'names the form it accepts when %s names the repository, in both of its problems',
    (_form, offending) => {
      const pinned = pinnedReadme(offending, repository, commit);

      expect(pinned).toEqual({
        kind: 'refused',
        problems: [
          {
            line: 1,
            problem: expect.stringContaining(
              `an inline link or image [text](${atMain}/<path>), with no title`,
            ),
          },
          {
            line: 1,
            problem: expect.stringContaining(
              `is on GitHub; a package README links GitHub only as [text](${atMain}/<path>)`,
            ),
          },
        ],
      });
    },
  );

  it('lists each of two relative links on one line', () => {
    const readme = afterOnePinnedLink('[a](./x.md) and [b](./x.md)');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 3, problem: expect.stringContaining('./x.md') },
        { line: 3, problem: expect.stringContaining('./x.md') },
      ],
    });
  });

  it('lists each of the four tags of two elements on one line', () => {
    const readme = afterOnePinnedLink('a <b>x</b> <b>y</b>');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 3, problem: expect.stringContaining('raw HTML "<b>"') },
        { line: 3, problem: expect.stringContaining('raw HTML "</b>"') },
        { line: 3, problem: expect.stringContaining('raw HTML "<b>"') },
        { line: 3, problem: expect.stringContaining('raw HTML "</b>"') },
      ],
    });
  });

  it('names a link to the repository split over two lines at the line of the link and at the line of the name', () => {
    const readme = afterOnePinnedLink(`[x](\nhttps://github.com/${repository}/tree/main/a)`);

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 3, problem: expect.stringContaining('is on GitHub') },
        { line: 4, problem: expect.stringContaining(repository) },
      ],
    });
  });

  it('names a definition at main once as a mention, and each of its uses and the definition as a link target', () => {
    const uses = '[a][r]\n\n[b][r]\n\n[c][r]';
    const readme = afterOnePinnedLink(`${uses}\n\n[r]: ${atMain}/CONTEXT.md`);

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 3, problem: expect.stringContaining('is on GitHub') },
        { line: 5, problem: expect.stringContaining('is on GitHub') },
        { line: 7, problem: expect.stringContaining('is on GitHub') },
        { line: 9, problem: expect.stringContaining('a reference to') },
        { line: 9, problem: expect.stringContaining('is on GitHub') },
      ],
    });
  });

  it('numbers the lines of a README with CRLF line ends as it does one with LF', () => {
    const lines = [`[ok](${atMain}/CONTEXT.md)`, '', '[x](', '../a.md)', '', `see ${repository}`];

    const withCrlf = pinnedReadme(lines.join('\r\n'), repository, commit);
    const withLf = pinnedReadme(lines.join('\n'), repository, commit);

    expect(withCrlf).toEqual({
      kind: 'refused',
      problems: [
        { line: 3, problem: expect.stringContaining('../a.md') },
        { line: 6, problem: expect.stringContaining(repository) },
      ],
    });
    expect(withLf).toEqual(withCrlf);
  });

  it('lists every problem of a README in line order, those of one line in the order found', () => {
    const readme = [
      '[x](../up.md)',
      `[ok](${atMain}/CONTEXT.md)`,
      `<${atMain}/CONTEXT.md>`,
      '[y](./b.md) <img src="https://x.io/a.png">',
    ].join('\n');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 1, problem: expect.stringContaining('../up.md') },
        { line: 3, problem: expect.stringContaining('a reference to') },
        { line: 3, problem: expect.stringContaining('is on GitHub') },
        { line: 4, problem: expect.stringContaining('./b.md') },
        { line: 4, problem: expect.stringContaining('raw HTML') },
      ],
    });
  });

  it('quotes a target whole as the parser reads it, and the first line of raw HTML', () => {
    const readme = [
      '[a](<../a b.md>)',
      '[b](../a\\).md)',
      '<img\n  src="https://x.io/a.png">',
    ].join('\n');

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [
        { line: 1, problem: expect.stringContaining('"../a b.md"') },
        { line: 2, problem: expect.stringContaining('"../a).md"') },
        { line: 3, problem: expect.stringContaining('"<img"') },
      ],
    });
  });
});

const targets: Record<string, string> = {
  'a relative file up': '../../COMPATIBILITY.md',
  'a dot-slash file': './a.png',
  'a bare file with an anchor': 'COMPATIBILITY.md#rules',
  'an empty target': '',
  'a protocol-relative target': '//github.com/x/y',
  'an anchor': '#anchor',
  'another host': 'https://zod.dev/api',
  'a scheme in capitals': 'HTTPS://zod.dev',
  'the repository at main': `${atMain}/CONTEXT.md#x`,
  'the repository at main with parentheses in its path': `${atMain}/a(b).md`,
  'the repository at tree/main': `https://github.com/${repository}/tree/main/packages`,
  'the repository in another case': 'https://github.com/casitafeliz/cf-loom/blob/main/x.md',
  'the repository with an escaped hyphen':
    'https://github.com/CasitaFeliz/cf\\-loom/blob/main/a.md',
  'the repository with an escaped slash': 'https://github.com/CasitaFeliz\\/cf-loom/blob/main/a.md',
  'the repository with a hexadecimal reference':
    'https://github.com/CasitaFeliz&#x2F;cf-loom/blob/main/a.md',
  'the repository with a decimal reference':
    'https://github.com/CasitaFeliz&#47;cf-loom/blob/main/a.md',
  'the repository with a named reference':
    'https://github.com/CasitaFeliz&sol;cf-loom/blob/main/a.md',
  'dots written as references': '&#46;&#46;/a.md',
  'a colon written as a reference': 'https&#58;//zod.dev',
  'a query with an ampersand': 'https://img.shields.io/x?a=1&b=2',
  'the repository with a percent-escaped letter':
    'https://github.com/CasitaFeliz/cf%2Dloom/blob/main/x.md',
  'the repository with a doubled slash': 'https://github.com/CasitaFeliz//cf-loom/blob/main/x.md',
  'the repository after a dot segment':
    'https://github.com/CasitaFeliz/x/../cf-loom/blob/main/x.md',
  'a path that climbs back to main': `${atMain}/../../../../${repository}/blob/main/x.md`,
  'a path that climbs back to main in percent-escapes': `${atMain}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/${repository}/blob/main/x.md`,
  'a path with an escaped slash and dots': `${atMain}/%2F..%2Fx.md`,
  'the repository with a query': `${atMain}/x.md?plain=1`,
  'the repository in capitals': `HTTPS://GitHub.COM/${repository}/blob/main/x.md`,
  'the repository on a host with a trailing dot': `https://github.com./${repository}/blob/main/x.md`,
  'the repository on a port': `https://github.com:8443/${repository}/blob/main/x.md`,
  'the repository with userinfo': `https://user@github.com/${repository}/blob/main/x.md`,
  'the repository on a percent-escaped host': `https://git%68ub.com/${repository}/blob/main/x.md`,
  'backslashes in place of slashes': 'https:\\\\github.com\\CasitaFeliz\\cf-loom\\tree\\main',
  'raw.githubusercontent.com': `https://raw.githubusercontent.com/${repository}/main/x.md`,
  'another repository at main': 'https://github.com/other/repo/blob/main/x.md',
  'another repository at a commit': `https://github.com/other/repo/blob/${commit}/x.md`,
  'a gist': 'https://gist.github.com/other/1',
  'github.dev with an escaped hyphen': 'https://github.dev/CasitaFeliz/cf%2Dloom/blob/main/x.md',
};

function indented(text: string, indent: string): string {
  return text.split('\n').join(`\n${indent}`);
}

function oneLine(text: string): string {
  return text.split('\n').join(' ');
}

const forms: Record<string, (target: string, label: string) => string> = {
  'an inline link': (target) => `[x](${target})`,
  'a link with a title': (target) => `[x](${target} "title")`,
  'a link in angle brackets': (target) => `[x](<${target}>)`,
  'a link split over two lines': (target) => `[x](\n${target})`,
  'an image': (target) => `![x](${target})`,
  'a link through its definition': (target, label) => `[x][r${label}]\n\n[r${label}]: ${target}`,
  'a definition with its target on the next line': (target, label) =>
    `[x][r${label}]\n\n[r${label}]:\n  ${target}`,
  'an autolink': (target) => `<${target}>`,
  'an HTML link': (target) => `<a href="${target}">x</a>`,
  'an HTML image': (target) => `<img src="${target}">`,
  'an HTML image with a srcset': (target) => `<img srcset="${target} 2x">`,
  'a comment holding a link': (target) => `<!-- [x](${target}) -->`,
  'a comment ended by <!--> before an image': (target) => `<!--> <img src="${target}"> -->`,
  'a comment ended by <!---> before an image': (target) => `<!---> <img src="${target}"> -->`,
  'a comment ended by --!> before an image': (target) => `<!-- c --!> <img src="${target}"> -->`,
  'a link around an image': (target) => `[![a](https://x.io/a.png)](${target})`,
  'a footnote holding a link': (target, label) =>
    `a[^1${label}]\n\n[^1${label}]: see [y](${target})`,
};

const codeContainers: Record<string, (form: string) => string> = {
  'a backtick fence': (form) => `\`\`\`md\n${form}\n\`\`\``,
  'a tilde fence': (form) => `~~~md\n${form}\n~~~`,
  'a four-backtick fence': (form) => `\`\`\`\`md\n\`\`\`\n${form}\n\`\`\`\n\`\`\`\``,
  'indented code': (form) => `    ${indented(form, '    ')}`,
  'a code span': (form) => `\`\` ${oneLine(form)} \`\``,
};

const containers: Record<string, (form: string) => string> = {
  'a paragraph': (form) => form,
  'a list item': (form) => `- a\n- ${indented(form, '  ')}`,
  'a task item': (form) => `- [ ] ${indented(form, '  ')}`,
  'a blockquote': (form) => `> ${indented(form, '> ')}`,
  'a list in a blockquote': (form) => `> - ${indented(form, '>   ')}`,
  'a table cell': (form) => `| a |\n|---|\n| ${oneLine(form)} |`,
  'a heading': (form) => `## ${oneLine(form)}`,
  'strong text': (form) => `**${form}**`,
  emphasis: (form) => `*${form}*`,
  'deleted text': (form) => `~~${form}~~`,
  ...codeContainers,
};

const header = [`[ok](${atMain}/CONTEXT.md)  `, 'second line', '', '***', '', '\\*escaped\\*'].join(
  '\n',
);
const blockLine = header.split('\n').length + 2;

type Case = { readonly name: string; readonly block: string; readonly readme: string };

function casesOf(inContainers: Record<string, (form: string) => string>): Case[] {
  const cases: Case[] = [];
  for (const [targetName, target] of Object.entries(targets)) {
    for (const [formName, form] of Object.entries(forms)) {
      for (const [containerName, container] of Object.entries(inContainers)) {
        const block = container(form(target, ''));
        const name = `${formName} to ${targetName} in ${containerName}`;
        cases.push({ name, block, readme: `${header}\n\n${block}\n` });
      }
    }
  }
  return cases;
}

const markedEscapes = /&(?:amp|lt|gt|quot|#39);/g;
const characterReference = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

function decodedByMarked(value: string): string {
  const escapes: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return value.replace(markedEscapes, (reference) => escapes[reference] ?? reference);
}

/** Where the comment whose body starts at `body` ends, as a browser ends it: `-->`, `--!>`, or the end of the text. */
function endOfCommentAt(html: string, body: number): number {
  const rest = html.slice(body);
  if (rest.startsWith('>')) {
    return body + 1;
  }
  if (rest.startsWith('->')) {
    return body + 2;
  }
  const closers = ['-->', '--!>'].map((closer) => ({ at: rest.indexOf(closer), closer }));
  const found = closers.filter(({ at }) => at !== -1);
  const ends = found.map(({ at, closer }) => body + at + closer.length);
  return ends.length === 0 ? html.length : Math.min(...ends);
}

function withoutComments(html: string): string {
  let kept = '';
  let from = 0;
  for (let open = html.indexOf('<!--'); open !== -1; open = html.indexOf('<!--', from)) {
    kept += html.slice(from, open);
    from = endOfCommentAt(html, open + 4);
  }
  return kept + html.slice(from);
}

const githubHosts = ['github.com', 'githubusercontent.com', 'github.dev'];

/** Whether a browser, parsing `url` as it is, lands on GitHub off a file of the repository at its commit. */
function isOnGitHubOffCommit(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const { hostname, pathname } = new URL(url);
  const host = hostname.replace(/\.$/, '');
  const isGitHub = githubHosts.some((family) => host === family || host.endsWith(`.${family}`));
  return isGitHub && !pathname.startsWith(`/${repository}/blob/${commit}/`);
}

/** What is wrong with one URL a browser would load, by what it does with it. */
function problemsOfUrl(url: string): string[] {
  const problems: string[] = [];
  const rest = url.replaceAll(`github.com/${repository}/blob/${commit}/`, '');
  if (!/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) {
    problems.push(`the URL ${url} has no scheme and is no anchor`);
  }
  if (/casitafeliz\/cf-loom/i.test(rest)) {
    problems.push(`the URL ${url} reaches the repository off its commit`);
  }
  if (isOnGitHubOffCommit(url)) {
    problems.push(`the URL ${url} is on GitHub and no file of the repository at its commit`);
  }
  return problems;
}

/** What a browser would load from the HTML `marked` renders: each URL attribute, with its problems. */
function urlProblemsOf(html: string): string[] {
  const tags = withoutComments(html).match(/<[a-z][^>]*>/gi) ?? [];
  const attributes = /\b(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const problems: string[] = [];
  for (const match of tags.flatMap((tag) => [...tag.matchAll(attributes)])) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (characterReference.test(value.replace(markedEscapes, ''))) {
      problems.push(`a character reference a browser decodes in ${value}`);
    }
    for (const candidate of decodedByMarked(value).split(',')) {
      for (const problem of problemsOfUrl(candidate.trim().split(/\s+/)[0] ?? '')) {
        problems.push(problem);
      }
    }
  }
  return problems;
}

function typesOf(readme: string): string[] {
  const types: string[] = [];
  void marked.walkTokens(Lexer.lex(readme, { gfm: true }), (token) => {
    types.push(token.type);
  });
  return types;
}

type Container = (copies: readonly string[]) => string;

const repeatedContainers: Record<string, Container> = {
  'a quote': (copies) => copies.map((copy) => `> ${indented(copy, '> ')}`).join('\n>\n'),
  'a list paragraph': (copies) => `- ${indented(copies.join('\n\n'), '  ')}`,
  'list items': (copies) => copies.map((copy) => `- ${indented(copy, '  ')}`).join('\n'),
  'a list in a quote': (copies) => copies.map((copy) => `> - ${indented(copy, '>   ')}`).join('\n'),
  'a nested quote': (copies) =>
    copies.map((copy) => `> > ${indented(copy, '> > ')}`).join('\n> >\n'),
};

type Block = { readonly form: string; readonly target: string; readonly leadsWithText: boolean };

function linesOfText(text: string): number {
  return text.split('\n').length;
}

function problemsOf(readme: string): readonly ReadmeProblem[] {
  const pinning = pinnedReadme(readme, repository, commit);
  return pinning.kind === 'refused' ? pinning.problems : [];
}

function problemLinesOf(readme: string): number[] {
  return problemsOf(readme).map(({ line }) => line);
}

function readmeOf(container: Container, copies: readonly string[]): string {
  return `${header}\n\n${container(copies)}\n`;
}

function copyOf(block: Block, label: string): string {
  const form = forms[block.form] as (target: string, label: string) => string;
  const text = form(targets[block.target] as string, label);
  return block.leadsWithText ? `a\n${text}` : text;
}

/** What each copy names when it stands alone in the container, moved to where the copy stands in the README. */
function expectedLinesOf(container: Container, copies: readonly string[]): number[] {
  const expected: number[] = [];
  for (const [index, own] of copies.entries()) {
    const start =
      linesOfText(container(copies.slice(0, index + 1))) - linesOfText(container([own]));
    for (const found of problemsOf(readmeOf(container, [own]))) {
      expected.push(found.line + start);
    }
  }
  return expected;
}

/** What differs between the lines a README names and the lines it must, or `undefined` when nothing does. */
function mismatchOf(named: readonly number[], expected: readonly number[]): string | undefined {
  const sorted = (lines: readonly number[]) => [...lines].sort((first, second) => first - second);
  if (JSON.stringify(sorted(named)) === JSON.stringify(sorted(expected))) {
    return undefined;
  }
  return `named ${sorted(named)}, expected ${sorted(expected)}`;
}

describe('pinnedReadme over a block repeated in a container', () => {
  const draw = aSeededDraw(421);
  const formNames = Object.keys(forms);
  const targetNames = Object.keys(targets);

  function aBlock(): Block {
    return {
      form: pickFrom(draw, formNames),
      target: pickFrom(draw, targetNames),
      leadsWithText: draw() < 0.5,
    };
  }

  /** Two to four copies, each the first block with a chance of 0.7 and a new one otherwise. */
  function repeatedBlocks(): Block[] {
    const first = aBlock();
    const length = 2 + Math.floor(draw() * 3);
    return Array.from({ length }, () => (draw() < 0.7 ? first : aBlock()));
  }

  it('names each problem on the line of its own copy, in every container', () => {
    const wrong: string[] = [];
    const drawn = {
      forms: new Set<string>(),
      targets: new Set<string>(),
      copies: new Set<number>(),
    };
    for (const entry of Object.entries(repeatedContainers)) {
      for (let sample = 0; sample < 1500; sample++) {
        const blocks = repeatedBlocks();
        const copies = blocks.map((block, index) => copyOf(block, String(index)));
        const mismatch = mismatchOf(
          problemLinesOf(readmeOf(entry[1], copies)),
          expectedLinesOf(entry[1], copies),
        );
        if (mismatch !== undefined) {
          wrong.push(`${entry[0]}: ${mismatch} in ${JSON.stringify(copies)}`);
        }
        for (const block of blocks) {
          drawn.forms.add(block.form);
          drawn.targets.add(block.target);
        }
        drawn.copies.add(copies.length);
      }
    }

    expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
    expect(drawn.forms).toEqual(new Set(formNames));
    expect(drawn.targets).toEqual(new Set(targetNames));
    expect(drawn.copies).toEqual(new Set([2, 3, 4]));
  });
});

describe('pinnedReadme over every target, form and container an author can write', () => {
  const cases = casesOf(containers);

  it('refuses each README on lines of its own block, or pins it with no rendered URL that reaches main', () => {
    const wrong: string[] = [];
    for (const { name, block, readme } of cases) {
      const pinning = pinnedReadme(readme, repository, commit);
      if (pinning.kind === 'refused') {
        const last = blockLine + block.split('\n').length - 1;
        const outside = pinning.problems.filter(({ line }) => line < blockLine || line > last);
        if (outside.length > 0) {
          wrong.push(
            `${name}: lines ${outside.map(({ line }) => line).join(', ')} are outside the block`,
          );
        }
      } else {
        const rendered = marked.parse(pinning.text, { gfm: true, async: false });
        for (const problem of urlProblemsOf(rendered)) {
          wrong.push(`${name}: ${problem}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('pins each target that is a file of the repository at main, written as a plain inline link', () => {
    const pinnable = [
      'the repository at main',
      'the repository at main with parentheses in its path',
    ];

    const pinnings = pinnable.map((name) =>
      pinnedReadme(`[x](${targets[name]})`, repository, commit),
    );

    expect(pinnings.map(({ kind }) => kind)).toEqual(['pinned', 'pinned']);
  });

  it('pins a README whose only offending form is code, unless it names the repository off the pinnable link', () => {
    const wrong: string[] = [];
    for (const { name, block, readme } of casesOf(codeContainers)) {
      const pinnable = /\]\(https:\/\/github\.com\/CasitaFeliz\/cf-loom\/blob\/main\/[^)\s]+\)/g;
      const names = /casitafeliz\/cf-loom/i.test(block.replace(pinnable, '').replaceAll('\\', ''));
      const pinning = pinnedReadme(readme, repository, commit);
      if ((pinning.kind === 'refused') !== names) {
        wrong.push(
          `${name}: ${pinning.kind}, but the form ${names ? 'names' : 'does not name'} the repository`,
        );
      }
    }

    expect(wrong).toEqual([]);
  });

  it('holds every target, form and container, and reaches every type of token marked produces', () => {
    const reached = new Set(cases.flatMap(({ readme }) => typesOf(readme)));
    const missing = Object.keys(tokenTypes).filter((type) => !reached.has(type));

    expect(missing).toEqual([]);
    expect(new Set(cases.map(({ name }) => name)).size).toBe(
      Object.keys(targets).length * Object.keys(forms).length * Object.keys(containers).length,
    );
  });
});
