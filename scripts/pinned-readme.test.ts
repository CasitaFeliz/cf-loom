import { describe, expect, it } from 'vitest';
import { pinnedReadme } from './pinned-readme.ts';

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
    [
      'a link to another repository',
      `[x](https://github.com/CasitaFeliz/other/blob/main/README.md)`,
    ],
    [
      'a link to a repository whose name starts with its own',
      `[x](https://github.com/CasitaFeliz/cf-loom-x/blob/main/README.md)`,
    ],
    [
      'a link to a repository whose owner ends with its own',
      `[x](https://github.com/my-CasitaFeliz/cf-loom/blob/main/README.md)`,
    ],
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
    const readme = [
      `[other](https://github.com/axb/c/blob/main/x.md)`,
      `[own](https://github.com/a.b/c/blob/main/x.md)`,
    ].join('\n');

    const pinned = pinnedReadme(readme, 'a.b/c', commit);

    expect(pinned).toEqual({
      kind: 'pinned',
      text: [
        `[other](https://github.com/axb/c/blob/main/x.md)`,
        `[own](https://github.com/a.b/c/blob/${commit}/x.md)`,
      ].join('\n'),
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
  ])('refuses %s, naming the line where it starts', (_form, offending, lines) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual(lines);
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
    ['a comment that closes abruptly before a tag', '<!--> <img src="./x">', [3]],
    ['a comment that --!> ends before a tag', '<!-- c --!> <img src="./x"> -->', [3]],
  ])('refuses raw HTML as %s, naming its line', (_form, offending, lines) => {
    const refused = refusedLinesOf(afterOnePinnedLink(offending));

    expect(refused).toEqual(lines);
  });

  it('lists every problem of a README in line order, two on one line both', () => {
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
        { line: 3, problem: expect.stringContaining(repository) },
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
