import type { SchemaNode, ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, isLive, nameAndVersionOf } from '@cf-loom/contract/internal';
import {
  addModulesOf,
  type DefUse,
  defsCodeOf,
  type Needs,
  noNeeds,
  reachedDefUsesOf,
  zodExpressionOf,
} from '../schema-code/index.ts';
import { byCommandName, readerNameOf } from './code-names.ts';

/** A Message Version by its name and version. */
export type MessageVersion = { readonly name: string; readonly version: number };

/** An own Message Version a Reader is written for, by its kind's key in the Snapshot and identity. */
export type Readable = {
  readonly kind: 'events' | 'commands';
  readonly identity: string;
  readonly message: MessageVersion;
  readonly body: SchemaNode;
};

/**
 * The Reader schemas of a Service's own Message Versions: what they are written for, the Commands
 * among them by name in code, their lines and those of the recursive defs they reach, and what
 * all of them import.
 */
export type ReaderSchemas = {
  readonly readables: readonly Readable[];
  readonly commands: readonly Readable[];
  readonly defUses: readonly DefUse[];
  readonly defs: readonly string[];
  readonly readers: readonly string[];
  readonly needs: Needs;
};

/** The Reader schemas of the Service's own Events and Commands, with the defs they reach, as readers. */
export function readerSchemasOf(snapshot: ServiceSnapshot): ReaderSchemas {
  const needs = noNeeds();
  const readables = readablesOf(snapshot);
  const commands = readables
    .filter(isCommandReadable)
    .sort((left, right) => byCommandName(left.message, right.message));
  const readers = readerLinesOf(readables, needs);
  const defUses = reachedDefUsesOf(snapshot.defs, [...needs.defs.values()]);
  const defs = defsCodeOf(snapshot.defs, defUses);
  addModulesOf(needs, defs.needs);
  return { readables, commands, defUses, defs: defs.body, readers, needs };
}

/** A Reader schema per own Message Version, recording what each needs imported. */
function readerLinesOf(readables: readonly Readable[], needs: Needs): readonly string[] {
  return readables.map(({ message, body }) => {
    const reader = zodExpressionOf(body, { mode: 'reader', needs });
    return `export const ${readerNameOf(message)} = ${reader};`;
  });
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

function isCommandReadable(
  readable: Readable,
): readable is Readable & { readonly kind: 'commands' } {
  return readable.kind === 'commands';
}
