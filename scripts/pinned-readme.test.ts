import type { MarkedToken } from 'marked';
import { Lexer, marked } from 'marked';
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

  it('names a link to the repository split over two lines once, at the line of the name', () => {
    const readme = afterOnePinnedLink(`[x](\nhttps://github.com/${repository}/tree/main/a)`);

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [{ line: 4, problem: expect.stringContaining(repository) }],
    });
  });

  it('names a definition at main once, at the definition, however often it is used', () => {
    const uses = '[a][r]\n\n[b][r]\n\n[c][r]';
    const readme = afterOnePinnedLink(`${uses}\n\n[r]: ${atMain}/CONTEXT.md`);

    const pinned = pinnedReadme(readme, repository, commit);

    expect(pinned).toEqual({
      kind: 'refused',
      problems: [{ line: 9, problem: expect.stringContaining(repository) }],
    });
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
};

function indented(text: string, indent: string): string {
  return text.split('\n').join(`\n${indent}`);
}

function oneLine(text: string): string {
  return text.split('\n').join(' ');
}

const forms: Record<string, (target: string) => string> = {
  'an inline link': (target) => `[x](${target})`,
  'a link with a title': (target) => `[x](${target} "title")`,
  'a link in angle brackets': (target) => `[x](<${target}>)`,
  'a link split over two lines': (target) => `[x](\n${target})`,
  'an image': (target) => `![x](${target})`,
  'a link through its definition': (target) => `[x][r]\n\n[r]: ${target}`,
  'a definition with its target on the next line': (target) => `[x][r]\n\n[r]:\n  ${target}`,
  'an autolink': (target) => `<${target}>`,
  'an HTML link': (target) => `<a href="${target}">x</a>`,
  'an HTML image': (target) => `<img src="${target}">`,
  'an HTML image with a srcset': (target) => `<img srcset="${target} 2x">`,
  'a comment holding a link': (target) => `<!-- [x](${target}) -->`,
  'a link around an image': (target) => `[![a](https://x.io/a.png)](${target})`,
  'a footnote holding a link': (target) => `a[^1]\n\n[^1]: see [y](${target})`,
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
        const block = container(form(target));
        const name = `${formName} to ${targetName} in ${containerName}`;
        cases.push({ name, block, readme: `${header}\n\n${block}\n` });
      }
    }
  }
  return cases;
}

const tokenTypes: Record<MarkedToken['type'], true> = {
  blockquote: true,
  br: true,
  checkbox: true,
  code: true,
  codespan: true,
  def: true,
  del: true,
  em: true,
  escape: true,
  heading: true,
  hr: true,
  html: true,
  image: true,
  link: true,
  list: true,
  // biome-ignore lint/style/useNamingConvention: marked names this token type list_item
  list_item: true,
  paragraph: true,
  space: true,
  strong: true,
  table: true,
  text: true,
};

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

/** What a browser would load from the HTML `marked` renders: each URL attribute, with its problems. */
function urlProblemsOf(html: string): string[] {
  const tags = html.replace(/<!--[\s\S]*?-->/g, '').match(/<[a-z][^>]*>/gi) ?? [];
  const attributes = /\b(?:href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const problems: string[] = [];
  for (const match of tags.flatMap((tag) => [...tag.matchAll(attributes)])) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (characterReference.test(value.replace(markedEscapes, ''))) {
      problems.push(`a character reference a browser decodes in ${value}`);
    }
    for (const candidate of decodedByMarked(value).split(',')) {
      const url = candidate.trim().split(/\s+/)[0] ?? '';
      const rest = url.replaceAll(`github.com/${repository}/blob/${commit}/`, '');
      if (!/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) {
        problems.push(`the URL ${url} has no scheme and is no anchor`);
      }
      if (/casitafeliz\/cf-loom/i.test(rest)) {
        problems.push(`the URL ${url} reaches the repository off its commit`);
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
