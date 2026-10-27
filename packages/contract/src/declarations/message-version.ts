/** Whether a value is a Message Version's version: a safe integer from 1, so its text and `version - 1` are exact. */
export function isMessageVersion(version: unknown): boolean {
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1;
}

/** The words that name the kind of a generated binding of a Message Version, written before `V` and its version. */
export const messageNameKinds = ['Event', 'Command', 'Reader', 'CommandHandler'] as const;

/** A word of `messageNameKinds`, or none for a key, whose map already says what it holds. */
export type MessageNameKind = '' | (typeof messageNameKinds)[number];

/** A Message Version's name in code as a key, with no kind: the type twin of `codeNameOf` called without one. */
export type CodeNameOf<Message extends { readonly name: string; readonly version: number }> =
  `${Uncapitalize<Message['name']>}V${Message['version']}`;

/**
 * A Message Version's name in code: its name with the first letter lower-cased, then `kind`, the word
 * that says what the name holds, then `V` and its version, so the version always comes last.
 * Without a kind it is the key a map that already says the kind uses (`orderCreatedV2`, the Handler map's
 * `commands` and the `readers` table); with one, a binding that meets other kinds' names in its scope:
 * `orderCreatedEventV2` as a Contract Package exports an Event's, `orderCreatedReaderV2` as the readers
 * file declares its Reader.
 *
 * @param message - The Message Version, by name and version.
 * @param kind - The word naming what the name holds, or nothing for a key.
 */
export function codeNameOf(
  message: { readonly name: string; readonly version: number },
  kind: MessageNameKind = '',
): string {
  return `${message.name.charAt(0).toLowerCase()}${message.name.slice(1)}${kind}V${message.version}`;
}
