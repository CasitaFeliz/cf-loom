import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, readEventReference } from '@cf-loom/contract/internal';
import type { FileExport } from '../loading/index.ts';
import {
  defNamesLineOf,
  type ImportLine,
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
import { byCommandName, importAliasOf, pairingNameOf, readerNameOf } from './code-names.ts';
import type { MessageHandled } from './handled.ts';
import { type Readable, readerSchemasOf } from './reader-schemas.ts';
import type { StubTarget } from './service-files.ts';

/** Where a Command's Message Version or a Subscription is exported under its name in code. */
type MessageAt = (message: MessageHandled) => FileExport;

/**
 * Where each Command's Message Version and Subscription of a Service is exported under its name
 * in code, or a line for every one that is not.
 */
export type MessageExports =
  | { readonly kind: 'located'; readonly atOf: MessageAt }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/**
 * The text of the readers file; the line saying which name cannot be written as code, which comes
 * before the lines naming each Command's Message Version or Subscription not exported under its
 * name in code.
 */
export type ReadersText =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unnamed'; readonly line: string }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** A Command's Message Version or a Subscription, imported under a local name, with its Reader. */
type Pairing = {
  readonly handled: MessageHandled;
  readonly at: FileExport;
  readonly local: string;
  readonly reader: string;
};

/** `withReader`, which pairs a declaration with its Reader, and the package it is imported from. */
const withReaderImport = { name: 'withReader', specifier: '@cf-loom/handlers' } as const;

/** The name the readers file exports its table of pairings under. */
const readersTable = 'readers';

/** The tables of the `readers` object, in the order they are written. */
const tableKeys = ['commands', 'subscriptions'] as const;

type TableKey = (typeof tableKeys)[number];

/** The table a pairing sits in and the name it has there, which the table lists and a stub passes. */
function tableMemberOf(handled: MessageHandled): { readonly key: TableKey; readonly name: string } {
  switch (handled.kind) {
    case 'command':
      return { key: 'commands', name: pairingNameOf(handled) };
    case 'subscription':
      return { key: 'subscriptions', name: pairingNameOf(handled) };
  }
}

/** Where a Message Handler's stub gets its pairing: the readers file's table, by kind and name. */
export function pairingTargetOf(handled: MessageHandled, readersFile: string): StubTarget {
  const imported = { kind: 'file', path: readersFile, name: readersTable } as const;
  const { key, name } = tableMemberOf(handled);
  return { imported, expression: `${readersTable}.${key}.${name}` };
}

/**
 * The text of the readers file written at `readersFile`: the Reader schemas of the Service's own
 * Events and Commands, and a table pairing each Command's Message Version and Subscription,
 * imported from where it is exported, with the Reader its Handler reads.
 */
export function readersTextOf(
  snapshot: ServiceSnapshot,
  readersFile: string,
  messages: MessageExports,
): ReadersText {
  const schemas = readerSchemasOf(snapshot);
  const unnamed = defNamesLineOf(schemas.defUses);
  if (unnamed !== undefined) {
    return { kind: 'unnamed', line: unnamed };
  }
  if (messages.kind === 'refused') {
    return messages;
  }
  const commands = schemas.readables
    .filter(isCommandReadable)
    .sort((left, right) => byCommandName(left.message, right.message))
    .map((readable) => commandPairingOf(readable, messages.atOf));
  const subscriptions = Object.entries(snapshot.subscriptions).map(([name, { event }]) =>
    subscriptionPairingOf(snapshot.name, { name, event }, messages.atOf),
  );
  const pairings = [...commands, ...subscriptions];
  const imports = importsOf(schemas.needs, pairings, readersFile);
  const body = bodyOf([schemas.defs, schemas.readers, tableLinesOf(pairings)]);
  return { kind: 'text', text: moduleTextOf({ first: [headerOf('generate')], imports, body }) };
}

function isCommandReadable(
  readable: Readable,
): readable is Readable & { readonly kind: 'commands' } {
  return readable.kind === 'commands';
}

/** A Command's Message Version paired with its own Reader. */
function commandPairingOf({ message }: Readable, atOf: MessageAt): Pairing {
  const handled = { kind: 'command', ...message } as const;
  const reader = readerNameOf(message);
  return { handled, at: atOf(handled), local: importAliasOf(handled), reader };
}

/**
 * A Subscription paired with its own Event's Reader, or with its Dependency's Event's body, which
 * the Provider's Contract Package wrote as a Reader.
 */
function subscriptionPairingOf(
  service: string,
  { name, event }: { readonly name: string; readonly event: string },
  atOf: MessageAt,
): Pairing {
  const handled = { kind: 'subscription', name } as const;
  const local = importAliasOf(handled);
  const received = readEventReference(event);
  if (received === undefined) {
    throw new Error(`The Snapshot's Subscription ${name} receives an unreadable Event: a bug.`);
  }
  const reader = received.service === service ? readerNameOf(received) : `${local}.event.body`;
  return { handled, at: atOf(handled), local, reader };
}

/** The table of pairings, one member per table key; none while there is no pairing. */
function tableLinesOf(pairings: readonly Pairing[]): readonly string[] {
  if (pairings.length === 0) {
    return [];
  }
  const members = tableKeys.map((key) =>
    memberLinesOf(
      key,
      pairings.filter(({ handled }) => tableMemberOf(handled).key === key),
    ),
  );
  return [`export const ${readersTable} = {`, ...members.flat(), '};'];
}

function memberLinesOf(key: TableKey, pairings: readonly Pairing[]): readonly string[] {
  if (pairings.length === 0) {
    return [`  ${key}: {},`];
  }
  const entries = pairings.map(({ handled, local, reader }) => {
    const pairing = `${withReaderImport.name}(${local}, ${reader})`;
    return `    ${tableMemberOf(handled).name}: ${pairing},`;
  });
  return [`  ${key}: {`, ...entries, '  },'];
}

/**
 * The imports the file needs, in code point order of their specifiers: each pairing's file and
 * `withReader`, with any pairing, and the modules its schemas call.
 */
function importsOf(
  needs: Needs,
  pairings: readonly Pairing[],
  readersFile: string,
): readonly string[] {
  const { name, specifier } = withReaderImport;
  const withReader = { specifier, line: namedImportOf([name], specifier) };
  const paired = pairings.length > 0 ? [withReader, ...pairedImportsOf(pairings, readersFile)] : [];
  return sortedImportLinesOf([...paired, ...schemaImportsOf(needs)]);
}

/** One import per file the pairings come from, each under the local names of its pairings. */
function pairedImportsOf(pairings: readonly Pairing[], readersFile: string): readonly ImportLine[] {
  const namesBySpecifier = new Map<string, string[]>();
  for (const { at, local } of pairings) {
    const specifier = relativeSpecifierOf(readersFile, at.path);
    const names = namesBySpecifier.get(specifier) ?? [];
    names.push(`${at.name} as ${local}`);
    namesBySpecifier.set(specifier, names);
  }
  return [...namesBySpecifier].map(([specifier, names]) => ({
    specifier,
    line: namedImportOf(names.sort(byCodePoint), specifier),
  }));
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
