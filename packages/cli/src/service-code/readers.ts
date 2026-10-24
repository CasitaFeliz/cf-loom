import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { type ExportedAt, rootPlaces } from '../loading/index.ts';
import {
  defIdentifierOf,
  defNamesLineOf,
  type ImportLine,
  importedBindings,
  type Needs,
  schemaImportsOf,
  sortedImportLinesOf,
} from '../schema-code/index.ts';
import {
  headerOf,
  moduleTextOf,
  namedImportOf,
  relativeSpecifierOf,
} from '../source-text/index.ts';
import {
  byCommandName,
  collidingSubscriptionLineOf,
  type MessageVersion,
  type NamedInCode,
  pairingNameOf,
  readerNameOf,
} from './code-names.ts';
import type { MessageHandled } from './handled.ts';
import { type Readable, type ReaderSchemas, readerSchemasOf } from './reader-schemas.ts';

/** The Event a Subscription receives: the Service's own, by name and version, or a Dependency's. */
type ReceivedEvent =
  | { readonly kind: 'own'; readonly event: MessageVersion }
  | { readonly kind: 'dependency' };

/** Where the root lists a Subscription, and whose Event it receives. */
type ListedSubscription = { readonly position: number; readonly receives: ReceivedEvent };

/**
 * Where the root lists each Command's Message Version, by identity, and each Subscription, by
 * name, so the readers file reaches the root's own declarations by position.
 */
export type RootLists = {
  readonly commands: ReadonlyMap<string, number>;
  readonly subscriptions: ReadonlyMap<string, ListedSubscription>;
};

/** The text of the readers file, or the line saying which name cannot be written as code. */
export type ReadersText =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unnamed'; readonly line: string };

/** Where a Message Handler's stub imports its pairing from: the readers file, under its name in code. */
export function pairingAtOf(handled: MessageHandled, readersFile: string): ExportedAt {
  return { kind: 'file', path: readersFile, name: pairingNameOf(handled) };
}

/**
 * The text of the readers file written at `readersFile`: the Reader schemas of the Service's own
 * Events and Commands, and each Command's Message Version and Subscription paired with the Reader
 * its Handler reads, reached through the root.
 */
export function readersTextOf(
  snapshot: ServiceSnapshot,
  lists: RootLists,
  readersFile: string,
): ReadersText {
  const schemas = readerSchemasOf(snapshot);
  const subscriptions = Object.keys(snapshot.subscriptions);
  const commands = schemas.readables
    .filter(isCommandReadable)
    .sort((left, right) => byCommandName(left.message, right.message));
  const taken = takenNamesOf(schemas, commands);
  const unnamed =
    defNamesLineOf(schemas.defUses) ?? collidingSubscriptionLineOf(taken, subscriptions);
  if (unnamed !== undefined) {
    return { kind: 'unnamed', line: unnamed };
  }
  const pairings = [
    ...commandPairingLinesOf(commands, lists),
    ...subscriptionPairingLinesOf(subscriptions, lists),
  ];
  const imports = importsOf(schemas.needs, pairings, readersFile);
  const body = bodyOf([schemas.defs, schemas.readers, pairings]);
  return { kind: 'text', text: moduleTextOf({ first: [headerOf('generate')], imports, body }) };
}

function isCommandReadable(
  readable: Readable,
): readable is Readable & { readonly kind: 'commands' } {
  return readable.kind === 'commands';
}

/** `withReader`, which pairs a declaration with its Reader, and the package it is imported from. */
const withReaderImport = { name: 'withReader', specifier: '@cf-loom/handlers' } as const;

/** The names the file imports, whether it writes their imports or not, so none flips a check. */
const importedNames: readonly string[] = [
  rootPlaces.service.exported,
  withReaderImport.name,
  ...Object.values(importedBindings),
];

/** Every name the file declares or imports but the Subscriptions' pairings, with what it names. */
function takenNamesOf(
  { readables, defUses }: ReaderSchemas,
  commands: readonly Readable[],
): readonly NamedInCode[] {
  const imports = importedNames.map((code) => ({ code, names: `the import ${code}` }));
  const defs = defUses.map(({ id, mode }) => ({
    code: defIdentifierOf(id, mode),
    names: `defs.${id}`,
  }));
  const readers = readables.map(({ kind, identity, message }) => ({
    code: readerNameOf(message),
    names: `the Reader of ${kind}.${identity}`,
  }));
  const pairings = commands.map(({ identity, message }) => ({
    code: pairingNameOf({ kind: 'command', ...message }),
    names: `commands.${identity}`,
  }));
  return [...imports, ...defs, ...readers, ...pairings];
}

/** Each Command's Message Version paired with its Reader, in the order given. */
function commandPairingLinesOf(commands: readonly Readable[], lists: RootLists): readonly string[] {
  return commands.map(({ identity, message }) => {
    const element = `${rootPlaces.service.exported}.commands[${positionOf(lists.commands, identity)}]`;
    const name = pairingNameOf({ kind: 'command', ...message });
    return `export const ${name} = ${withReaderImport.name}(${element}, ${readerNameOf(message)});`;
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
    const reader = receivedReaderOf(listed.receives, element);
    const pairing = pairingNameOf({ kind: 'subscription', name });
    return `export const ${pairing} = ${withReaderImport.name}(${element}, ${reader});`;
  });
}

/** The Reader a Subscription's Handler reads: its own Event's, or its Dependency's Event's body. */
function receivedReaderOf(receives: ReceivedEvent, element: string): string {
  switch (receives.kind) {
    case 'own':
      return readerNameOf(receives.event);
    case 'dependency':
      return `${element}.event.body`;
  }
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
function importsOf(
  needs: Needs,
  pairings: readonly string[],
  readersFile: string,
): readonly string[] {
  const { file, exported } = rootPlaces.service;
  const root = relativeSpecifierOf(readersFile, file);
  const { name, specifier } = withReaderImport;
  const pairingImports: readonly ImportLine[] = [
    { specifier: root, line: namedImportOf([exported], root) },
    { specifier, line: namedImportOf([name], specifier) },
  ];
  return sortedImportLinesOf([
    ...(pairings.length > 0 ? pairingImports : []),
    ...schemaImportsOf(needs),
  ]);
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
