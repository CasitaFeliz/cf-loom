import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineDefinitions,
  defineEvent,
  defineGroup,
  defineGuard,
  defineService,
} from '../index.ts';
import {
  codeNameOf,
  type Failure,
  kebabCaseOf,
  type Root,
  type RootPackage,
  type Site,
  validateRoot,
} from '../internal/index.ts';

const alphabet = ['a', 'b', 'A', 'B', '1'];

/** Every string over the alphabet from one letter to `length` letters. */
function stringsUpTo(length: number): readonly string[] {
  let current = [''];
  const all: string[] = [];
  for (let size = 1; size <= length; size += 1) {
    current = current.flatMap((prefix) => alphabet.map((letter) => `${prefix}${letter}`));
    all.push(...current);
  }
  return all;
}

const candidates = stringsUpTo(5);

function isUpper(letter: string): boolean {
  return letter >= 'A' && letter <= 'Z';
}

/** Whether every capital of a name is followed by a lower-case letter or a digit, written apart from the grammar. */
function startsEveryWord(name: string): boolean {
  return [...name].every((letter, index) => {
    const next = name[index + 1];
    return !isUpper(letter) || (next !== undefined && !isUpper(next));
  });
}

function isNameGrammar(broken: Failure): boolean {
  return broken.kind === 'declaration' && broken.rule === 'name-grammar';
}

/** The name a Guard or an Event sits at, an Event's Message Version `@1` cut. */
function nameAt(site: Site): string {
  if (site.kind === 'guard') {
    return site.name;
  }
  if (site.kind === 'event') {
    return site.identity.replace(/@1$/, '');
  }
  throw new Error(`a ${site.kind} site holds no name under test`);
}

/** The names whose `name-grammar` failure sits at their Guard or Event. */
function failingNames(root: Root, given: Partial<RootPackage>): ReadonlySet<string> {
  const validated = validateRoot(root, aRootPackage(root, given));
  const failures = validated.kind === 'invalid' ? validated.failures : [];
  const grammar = failures.filter((broken) => isNameGrammar(broken));
  return new Set(grammar.map(({ site }) => nameAt(site)));
}

/** The Guard names, out of the candidates, that the name grammar refuses. */
const guardsPackage = defineDefinitions({});
const refusedElementNames = failingNames(guardsPackage, {
  rootExports: Object.fromEntries(
    candidates.map((name, index) => [
      `guard${index}`,
      defineGuard({ name, description: 'A guard' }),
    ]),
  ),
});

/** The Message names, out of the candidates, that the name grammar refuses. */
const refusedMessageNames = failingNames(
  defineService({
    name: 'orders-service',
    groups: [
      defineGroup({
        name: 'messages',
        description: 'Messages',
        events: candidates.map((name) =>
          defineEvent({
            name,
            version: 1,
            visibility: 'internal',
            description: 'An event',
            body: z.object({}),
          }),
        ),
      } as unknown as Parameters<typeof defineGroup>[0]),
    ],
  }),
  { packageName: 'orders-service' },
);

const elementNames = candidates.filter((name) => !refusedElementNames.has(name));
const messageNames = candidates.filter((name) => !refusedMessageNames.has(name));

describe('validateRoot: names are words', () => {
  test('an Element name is accepted exactly when it starts lower-case and every capital starts a word', () => {
    const expected = candidates.filter((name) => /^[a-z]/.test(name) && startsEveryWord(name));

    expect(elementNames).toEqual(expected);
  });

  test('a Message name is accepted exactly when it starts with a capital and every capital starts a word', () => {
    const expected = candidates.filter(
      (name) => /^[A-Z][a-z0-9]/.test(name) && startsEveryWord(name),
    );

    expect(messageNames).toEqual(expected);
  });

  test('every accepted Element name has a kebab-case spelling of its own that reads back to it', () => {
    const kebabs = elementNames.map(kebabCaseOf);
    const readBack = kebabs.map((kebab) => kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));

    expect(new Set(kebabs).size).toBe(elementNames.length);
    expect(readBack).toEqual(elementNames);
  });

  test('every accepted Message name has a code name and a kebab-case file name of its own that read back to it', () => {
    const codeNames = messageNames.map((name) => codeNameOf({ name, version: 1 }));
    const kebabs = messageNames.map((name) =>
      kebabCaseOf(`${name.charAt(0).toLowerCase()}${name.slice(1)}`),
    );
    const fromCodeNames = codeNames.map(
      (code) => `${code.charAt(0).toUpperCase()}${code.slice(1, -2)}`,
    );
    const fromKebabs = kebabs.map((kebab) => {
      const camel = kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
    });

    expect(new Set(codeNames).size).toBe(messageNames.length);
    expect(new Set(kebabs).size).toBe(messageNames.length);
    expect(fromCodeNames).toEqual(messageNames);
    expect(fromKebabs).toEqual(messageNames);
  });
});
