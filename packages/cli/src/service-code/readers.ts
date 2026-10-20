import type { SchemaNode, ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, codeNameOf, isLive, nameAndVersionOf } from '@cf-loom/contract/internal';
import { type ExportedAt, rootPlaces } from '../loading/index.ts';
import {
  type DefUse,
  defIdentifierOf,
  defNamesLineOf,
  defsCodeOf,
  type ImportLine,
  type Needs,
  noNeeds,
  reachedDefUsesOf,
  schemaImportsOf,
  zodExpressionOf,
} from '../schema-code/index.ts';
import {
  headerOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
} from '../source-text/index.ts';
import {
  collidingSubscriptionLineOf,
  type NamedInCode,
  pairingNameOf,
  readerNameOf,
} from './code-names.ts';
import type { MessageHandled } from './handled.ts';

/** The file of the Reader schemas of the Service's own Messages and of its pairings. */
export const readersFile = 'src/readers.generated.ts';

/** A Message Version by its name and version. */
type MessageVersion = { readonly name: string; readonly version: number };

/** Where the root lists a Subscription, and the Service's own Event it receives; none for a Dependency's. */
export type ListedSubscription = {
  readonly position: number;
  readonly ownEvent: MessageVersion | undefined;
};

/**
 * Where the root lists each Command's Message Version, by identity, and each Subscription, by
 * name, so `readers.generated.ts` reaches the root's own declarations by position.
 */
export type RootLists = {
  readonly commands: ReadonlyMap<string, number>;
  readonly subscriptions: ReadonlyMap<string, ListedSubscription>;
};

/** The text of `readers.generated.ts`, or the line saying which name cannot be written as code. */
export type ReadersText =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unnamed'; readonly line: string };

/** Where a Message Handler's stub imports its pairing from: the readers, under its name in code. */
export function pairingAtOf(handled: MessageHandled): ExportedAt {
  return { kind: 'file', path: readersFile, name: pairingNameOf(handled) };
}

/** An own Message Version a Reader is written for, by its kind's key in the Snapshot and identity. */
type Readable = {
  readonly kind: 'events' | 'commands';
  readonly identity: string;
  readonly message: MessageVersion;
  readonly body: SchemaNode;
};

/**
 * The Reader schemas of the Service's own Events and Commands, and each Command's Message Version
 * and Subscription paired with the Reader its Handler reads, reached through the root.
 */
export function readersTextOf(snapshot: ServiceSnapshot, lists: RootLists): ReadersText {
  const needs = noNeeds();
  const readables = readablesOf(snapshot);
  const readers = readables.map(({ message, body }) => {
    const reader = zodExpressionOf(body, { mode: 'reader', needs });
    return `export const ${readerNameOf(message)} = ${reader};`;
  });
  const defUses = reachedDefUsesOf(snapshot.defs, [...needs.defs.values()]);
  const subscriptions = Object.keys(snapshot.subscriptions);
  const taken = takenNamesOf(readables, defUses);
  const unnamed = defNamesLineOf(defUses) ?? collidingSubscriptionLineOf(taken, subscriptions);
  if (unnamed !== undefined) {
    return { kind: 'unnamed', line: unnamed };
  }
  const defs = defsCodeOf(snapshot.defs, defUses);
  for (const module of defs.needs.modules) {
    needs.modules.add(module);
  }
  const pairings = [
    ...commandPairingLinesOf(readables, lists),
    ...subscriptionPairingLinesOf(subscriptions, lists),
  ];
  const imports = importsOf(needs, pairings);
  const body = bodyOf([defs.body, readers, pairings]);
  return { kind: 'text', text: moduleTextOf({ first: [headerOf('generate')], imports, body }) };
}

/**
 * Every own Message Version a Reader is written for, in code point order of its Reader: each
 * Event that is not Retired, since no Subscription reads a Retired one, and each Command's, whose
 * Handler compiles as long as it is declared.
 */
function readablesOf(snapshot: ServiceSnapshot): readonly Readable[] {
  const events = Object.entries(snapshot.events).filter(([, event]) => isLive(event));
  const readables = [
    ...events.map(([identity, { body }]) => readableOf('events', identity, body)),
    ...Object.entries(snapshot.commands).map(([identity, { body }]) =>
      readableOf('commands', identity, body),
    ),
  ];
  return readables.sort((left, right) =>
    byCodePoint(readerNameOf(left.message), readerNameOf(right.message)),
  );
}

function readableOf(kind: Readable['kind'], identity: string, body: SchemaNode): Readable {
  return { kind, identity, message: nameAndVersionOf(identity), body };
}

/** The names the file imports, whether it writes their imports or not, so none flips a check. */
const importedNames: readonly string[] = [rootPlaces.service.exported, 'loom', 'withReader', 'z'];

/** Every name the file declares or imports but the Subscriptions' pairings, with what it names. */
function takenNamesOf(
  readables: readonly Readable[],
  defUses: readonly DefUse[],
): readonly NamedInCode[] {
  const imports = importedNames.map((code) => ({ code, names: `the import ${code}` }));
  const defs = defUses.map(({ id, mode }) => ({
    code: defIdentifierOf(id, mode),
    names: `defs.${id}`,
  }));
  const readers = readables.map(({ kind, identity, message }) => ({
    code: readerNameOf(message),
    names: `${kind}.${identity}`,
  }));
  const commands = readables
    .filter(({ kind }) => kind === 'commands')
    .map(({ identity, message }) => ({ code: codeNameOf(message), names: `commands.${identity}` }));
  return [...imports, ...defs, ...readers, ...commands];
}

/** Each Command's Message Version paired with its Reader, by name in code. */
function commandPairingLinesOf(
  readables: readonly Readable[],
  lists: RootLists,
): readonly string[] {
  const commands = readables
    .filter(({ kind }) => kind === 'commands')
    .sort((left, right) => byCodePoint(codeNameOf(left.message), codeNameOf(right.message)));
  return commands.map(({ identity, message }) => {
    const element = `${rootPlaces.service.exported}.commands[${positionOf(lists.commands, identity)}]`;
    const name = pairingNameOf({ kind: 'command', ...message });
    return `export const ${name} = withReader(${element}, ${readerNameOf(message)});`;
  });
}

/**
 * Each Subscription, by name, paired with its own Event's Reader, or with its Dependency's Event's
 * body, which the Provider's Contract Package wrote as a Reader.
 */
function subscriptionPairingLinesOf(
  subscriptions: readonly string[],
  lists: RootLists,
): readonly string[] {
  return subscriptions.map((name) => {
    const listed = lists.subscriptions.get(name);
    if (listed === undefined) {
      throw new Error(`The root lists no Subscription ${name}, which its Snapshot holds: a bug.`);
    }
    const element = `${rootPlaces.service.exported}.subscriptions[${listed.position}]`;
    const reader =
      listed.ownEvent === undefined ? `${element}.event.body` : readerNameOf(listed.ownEvent);
    const pairing = pairingNameOf({ kind: 'subscription', name });
    return `export const ${pairing} = withReader(${element}, ${reader});`;
  });
}

function positionOf(positions: ReadonlyMap<string, number>, identity: string): number {
  const position = positions.get(identity);
  if (position === undefined) {
    throw new Error(`The root lists no ${identity}, which its Snapshot holds: a bug.`);
  }
  return position;
}

/**
 * The imports the file needs, in code point order of their specifiers: the root and `withReader`
 * with any pairing, and the modules its schemas call.
 */
function importsOf(needs: Needs, pairings: readonly string[]): readonly string[] {
  const { file, exported } = rootPlaces.service;
  const root = relativeSpecifierOf(readersFile, file);
  const pairingImports: readonly ImportLine[] = [
    { specifier: root, line: namedImportOf([exported], root) },
    { specifier: '@cf-loom/handlers', line: namedImportOf(['withReader'], '@cf-loom/handlers') },
  ];
  const imports = [...(pairings.length > 0 ? pairingImports : []), ...schemaImportsOf(needs)];
  const sorted = imports.sort((left, right) => byCodePoint(left.specifier, right.specifier));
  return sorted.map(({ line }) => line);
}

/** The groups of the body, a blank line between two, or an empty module when none holds a line. */
function bodyOf(groups: readonly (readonly string[])[]): readonly string[] {
  const written = groups.filter((group) => group.length > 0);
  if (written.length === 0) {
    return ['export {};'];
  }
  const [first = [], ...rest] = written;
  return [...first, ...rest.flatMap((group) => ['', ...group])];
}
