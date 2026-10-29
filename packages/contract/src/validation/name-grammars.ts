import {
  type CappedGrammar,
  elementName,
  follows,
  isReserved,
  kebabCase,
  nameNouns,
  pascalCase,
  type RootKind,
  reservedNameSentence,
  upperSnakeCase,
  wordsOf,
} from '../declarations/index.ts';
import { inFields, type Place, placeOf } from '../walker/index.ts';
import { type Declarations, textOf, writtenTextOf } from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A name as declared, where it sits, and what the sentence calls it: `A Group name`. */
type Named = { readonly at: Place; readonly value: unknown; readonly noun: string };

/** Every name of a Root follows the grammar of its kind; a name that is no string is another rule's. */
export function nameFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, groups, endpoints, guards, rejections, standardRejections } = declarations;
  const { events, commands, subscriptions } = declarations;
  const kebab = named(groups, (listed) => listed.group.name, 'A Group name');
  const camel = [
    ...named(endpoints, (listed) => listed.endpoint.name, nameNouns.endpoint),
    ...named(guards, (listed) => listed.guard.name, nameNouns.guard),
    ...named(subscriptions, (listed) => listed.subscription.name, nameNouns.subscription),
  ];
  const pascal = [
    ...named(events, (listed) => listed.event.name, 'A Message name'),
    ...named(commands, (listed) => listed.command.name, 'A Message name'),
  ];
  const upperSnake = [
    ...codes(rejections, (listed) => listed.rejection.code),
    ...codes(standardRejections, (listed) => listed.declaration.code),
  ];
  return [
    ...rootNameFailures(root),
    ...grammarFailures(kebab, kebabCase),
    ...grammarFailures(camel, elementName),
    ...grammarFailures(pascal, pascalCase),
    ...grammarFailures(upperSnake, upperSnakeCase),
  ];
}

function named<Located extends { readonly at: Place }>(
  list: readonly Located[],
  nameOf: (located: Located) => unknown,
  noun: string,
): readonly Named[] {
  return list.map((located) => ({
    at: inFields(located.at, 'name'),
    value: nameOf(located),
    noun,
  }));
}

function codes<Located extends { readonly at: Place }>(
  list: readonly Located[],
  codeOf: (located: Located) => unknown,
): readonly Named[] {
  return list.map((located) => ({
    at: inFields(located.at, 'code'),
    value: codeOf(located),
    noun: 'A Rejection code',
  }));
}

function grammarFailures(
  named: readonly Named[],
  grammar: CappedGrammar,
): readonly DeclarationFailure[] {
  const breaking = named.filter(
    ({ value }) => typeof value === 'string' && !follows(grammar, value),
  );
  return breaking.map(({ at, value, noun }) =>
    failure(at, 'name-grammar', grammarMessageOf(grammar, noun, value)),
  );
}

/** What a name that breaks its grammar is told: a reserved word as the types tell it too. */
function grammarMessageOf(grammar: CappedGrammar, noun: string, value: unknown): string {
  const text = textOf(value);
  if (brokenPartOf(grammar, text) === 'reserved') {
    return `${reservedNameSentence(noun, text)}${hintFor(grammar, text)}`;
  }
  const { rule, note } = toldOf(grammar, text);
  return `${noun} is ${rule}: ${writtenTextOf(value)}${note}`;
}

/** The rule a name breaks, and what follows the name as written. */
type Told = { readonly rule: string; readonly note: string };

/** The part of its grammar a name breaks, its length when its pattern and words hold. */
function brokenPartOf(grammar: CappedGrammar, text: string): 'pattern' | 'reserved' | 'length' {
  if (isReserved(grammar, text)) {
    return 'reserved';
  }
  return grammar.pattern.test(text) ? 'length' : 'pattern';
}

/**
 * What a name that does not follow its grammar's pattern or length is told: `kebab-case` or `at most
 * 64 characters`, with the name to write instead or its length.
 */
function toldOf(grammar: CappedGrammar, text: string): Told {
  switch (brokenPartOf(grammar, text)) {
    case 'pattern':
    case 'reserved':
      return { rule: grammar.name, note: hintFor(grammar, text) };
    case 'length':
      return {
        rule: `at most ${grammar.maxLength} characters`,
        note: ` (${text.length} characters)`,
      };
  }
}

/** The name to write instead, when re-spelling its capitals as words yields one the grammar accepts. */
function hintFor(grammar: CappedGrammar, text: string): string {
  const words = wordsOf(text);
  return follows(grammar, words) ? ` (write ${words})` : '';
}

/** The grammar of a Service's and an Application's name, the one place it is named. */
const rootNameGrammar = kebabCase;

/** The kinds of Root that are named. */
type RootNamedKind = 'service' | 'application';

/** What a Service's and an Application's name is called in a sentence. */
const rootNouns = { service: 'A Service name', application: 'An Application name' } as const;

/**
 * Why a name cannot be a Root's, as the clause validation fails it with, such as `a Service name
 * is kebab-case`; nothing when it follows the grammar of its kind, and for a Definitions Package,
 * which has no name but its package.json's.
 */
export function rootNameProblemOf(kind: RootKind, name: string): string | undefined {
  switch (kind) {
    case 'service':
    case 'application': {
      if (follows(rootNameGrammar, name)) {
        return undefined;
      }
      const { rule } = toldOf(rootNameGrammar, name);
      const noun = rootNouns[kind];
      return `${noun.charAt(0).toLowerCase()}${noun.slice(1)} is ${rule}`;
    }
    case 'definitions':
      return undefined;
  }
}

/** A Service's or Application's name follows its grammar; a Definitions Package has none. */
function rootNameFailures(root: Declarations['root']): readonly DeclarationFailure[] {
  switch (root.kind) {
    case 'service':
    case 'application':
      return grammarFailures(rootNamed(root), rootNameGrammar);
    case 'definitions':
      return [];
  }
}

function rootNamed(
  root: Extract<Declarations['root'], { readonly kind: RootNamedKind }>,
): readonly Named[] {
  const at = inFields(placeOf({ kind: 'root' }, root), 'name');
  return [{ at, value: root.name, noun: rootNouns[root.kind] }];
}
