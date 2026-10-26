import {
  elementName,
  follows,
  type Grammar,
  isReserved,
  kebabCase,
  pascalCase,
  type RootKind,
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
    ...named(endpoints, (listed) => listed.endpoint.name, 'An Endpoint name'),
    ...named(guards, (listed) => listed.guard.name, 'A Guard name'),
    ...named(subscriptions, (listed) => listed.subscription.name, 'A Subscription name'),
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

function grammarFailures(named: readonly Named[], grammar: Grammar): readonly DeclarationFailure[] {
  const breaking = named.filter(
    ({ value }) => typeof value === 'string' && !follows(grammar, value),
  );
  return breaking.map(({ at, value, noun }) => {
    const text = textOf(value);
    const sentence = ruleSentenceOf(noun, grammar, text);
    const echoed = `${writtenTextOf(value)}${hintFor(grammar, text)}`;
    return failure(at, 'name-grammar', `${sentence}: ${echoed}`);
  });
}

/** What a name that breaks a grammar is told: `A Group name is kebab-case`, or that and no reserved word. */
function ruleSentenceOf(noun: string, grammar: Grammar, text: string): string {
  const rule = isReserved(grammar, text) ? `${grammar.name} and no reserved word` : grammar.name;
  return `${noun} is ${rule}`;
}

/** The name to write instead, when re-spelling its capitals as words yields one the grammar accepts. */
function hintFor(grammar: Grammar, text: string): string {
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
      const sentence = ruleSentenceOf(rootNouns[kind], rootNameGrammar, name);
      return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
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
