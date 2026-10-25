import {
  elementName,
  follows,
  type Grammar,
  isReserved,
  kebabCase,
  pascalCase,
  upperSnakeCase,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { type Declarations, textOf } from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A name as declared, where it sits, and what the sentence calls it: `A Group name`. */
type Named = { readonly at: Path; readonly value: unknown; readonly noun: string };

/** Every name of a root follows the grammar of its kind; a name that is no string is another rule's. */
export function nameFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, groups, listedDefinitions, endpoints, guards, rejections, standardRejections } =
    declarations;
  const { events, commands, subscriptions } = declarations;
  const kebab = [
    { at: ['name'], value: root.name, noun: rootNoun(root.kind) },
    ...named(listedDefinitions, (listed) => listed.definitions.name, 'A Definitions Package name'),
    ...named(groups, (listed) => listed.group.name, 'A Group name'),
  ];
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
    ...grammarFailures(kebab, kebabCase),
    ...grammarFailures(camel, elementName),
    ...grammarFailures(pascal, pascalCase),
    ...grammarFailures(upperSnake, upperSnakeCase),
  ];
}

function named<Located extends { readonly at: Path }>(
  list: readonly Located[],
  nameOf: (located: Located) => unknown,
  noun: string,
): readonly Named[] {
  return list.map((located) => ({ at: [...located.at, 'name'], value: nameOf(located), noun }));
}

function codes<Located extends { readonly at: Path }>(
  list: readonly Located[],
  codeOf: (located: Located) => unknown,
): readonly Named[] {
  return list.map((located) => ({
    at: [...located.at, 'code'],
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
    const rule = isReserved(grammar, text) ? `${grammar.name} and no reserved word` : grammar.name;
    return failure(at, 'name-grammar', `${noun} is ${rule}: ${text}`);
  });
}

function rootNoun(kind: Declarations['root']['kind']): string {
  switch (kind) {
    case 'contract':
      return 'A Service name';
    case 'application':
      return 'An Application name';
    case 'definitions':
      return 'A Definitions Package name';
  }
}
