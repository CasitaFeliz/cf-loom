import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineApplication,
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
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

const listOrders = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({})) },
} as const;

const orderCreated = {
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({}),
} as const;

/** A Service of one Group, which lists what the declaration lists, as a cast lets an author write it. */
function aServiceOf(group: Record<string, unknown>, name = 'orders-service'): Root {
  const declaration = { name: 'orders', description: 'Orders', ...group };
  const orders = defineGroup(declaration as unknown as Parameters<typeof defineGroup>[0]);
  return defineService({ name, groups: [orders] });
}

function anEndpointWith(declaration: Record<string, unknown>) {
  return defineEndpoint({ ...listOrders, ...declaration });
}

/** A name of a grammar with exactly `length` characters, and a name of its kind that breaks its pattern. */
const kebabWith = (length: number) => 'a'.repeat(length);
const camelWordsWith = (length: number) => 'a'.repeat(length);
const pascalWordsWith = (length: number) => `A${'a'.repeat(length - 1)}`;
const upperSnakeWith = (length: number) => 'A'.repeat(length);

type CappedName = {
  readonly noun: string;
  readonly grammar: string;
  readonly nameWith: (length: number) => string;
  readonly breakingPattern: string;
  readonly place: (name: string) => string;
  readonly rootWith: (name: string) => Root;
};

const cappedNames: readonly CappedName[] = [
  {
    noun: 'A Service name',
    grammar: 'kebab-case',
    nameWith: kebabWith,
    breakingPattern: 'A'.repeat(70),
    place: () => '(root) name',
    rootWith: (name) => aServiceOf({ endpoints: [defineEndpoint(listOrders)] }, name),
  },
  {
    noun: 'An Application name',
    grammar: 'kebab-case',
    nameWith: kebabWith,
    breakingPattern: 'A'.repeat(70),
    place: () => '(root) name',
    rootWith: (name) => defineApplication({ name, dependencies: [] }),
  },
  {
    noun: 'A Group name',
    grammar: 'kebab-case',
    nameWith: kebabWith,
    breakingPattern: 'A'.repeat(70),
    place: (name) => `groups.${name} name`,
    rootWith: (name) => aServiceOf({ name, endpoints: [defineEndpoint(listOrders)] }),
  },
  {
    noun: 'An Endpoint name',
    grammar: 'camelCase words',
    nameWith: camelWordsWith,
    breakingPattern: 'A'.repeat(70),
    place: (name) => `endpoints.GET /orders (${name}) name`,
    rootWith: (name) => aServiceOf({ endpoints: [anEndpointWith({ name })] }),
  },
  {
    noun: 'A Guard name',
    grammar: 'camelCase words',
    nameWith: camelWordsWith,
    breakingPattern: 'A'.repeat(70),
    place: (name) => `guards.${name} name`,
    rootWith: (name) => {
      const guard = defineGuard({ name, description: 'A guard' });
      return aServiceOf({ endpoints: [anEndpointWith({ guards: [guard] })] });
    },
  },
  {
    noun: 'A Subscription name',
    grammar: 'camelCase words',
    nameWith: camelWordsWith,
    breakingPattern: 'A'.repeat(70),
    place: (name) => `subscriptions.${name} name`,
    rootWith: (name) => {
      const event = defineEvent(orderCreated);
      const subscription = defineSubscription({ name, description: 'Receives it', event });
      return aServiceOf({ events: [event], subscriptions: [subscription] });
    },
  },
  {
    noun: 'A Message name',
    grammar: 'PascalCase words',
    nameWith: pascalWordsWith,
    breakingPattern: 'A'.repeat(70),
    place: (name) => `events.${name}@1 name`,
    rootWith: (name) => aServiceOf({ events: [defineEvent({ ...orderCreated, name })] }),
  },
  {
    noun: 'A Rejection code',
    grammar: 'UPPER_SNAKE_CASE',
    nameWith: upperSnakeWith,
    breakingPattern: 'a'.repeat(70),
    place: (code) => `codes.${code} code`,
    rootWith: (code) => {
      const rejection = defineRejection({ code, status: 409, message: 'Locked' });
      return aServiceOf({ endpoints: [anEndpointWith({ rejections: [rejection] })] });
    },
  },
];

function validateCapped(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

function failedAt(location: string, message: string) {
  return {
    kind: 'invalid',
    failures: [{ kind: 'declaration', location, rule: 'name-grammar', message }],
  };
}

describe('validateRoot: names have at most 64 characters', () => {
  test.for(cappedNames)('$noun of 64 characters validates', ({ nameWith, rootWith }) => {
    const root = rootWith(nameWith(64));

    expect(validateCapped(root).kind).toBe('valid');
  });

  test.for(cappedNames)(
    '$noun of 65 characters fails, naming its length',
    ({ noun, nameWith, place, rootWith }) => {
      const name = nameWith(65);

      const validated = validateCapped(rootWith(name));

      expect(validated).toEqual(
        failedAt(place(name), `${noun} is at most 64 characters: "${name}" (65 characters)`),
      );
    },
  );

  test.for(cappedNames)(
    '$noun that breaks its pattern and the cap gets the pattern sentence alone',
    ({ noun, grammar, breakingPattern, place, rootWith }) => {
      const validated = validateCapped(rootWith(breakingPattern));

      expect(validated).toEqual(
        failedAt(place(breakingPattern), `${noun} is ${grammar}: "${breakingPattern}"`),
      );
    },
  );
});
