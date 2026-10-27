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
 * A Message Version's name in code; a kind's word, when given, sits before `V` and its version, so
 * the version always comes last.
 */
export function codeNameOf(
  message: { readonly name: string; readonly version: number },
  kind: MessageNameKind = '',
): string {
  return `${message.name.charAt(0).toLowerCase()}${message.name.slice(1)}${kind}V${message.version}`;
}

/** The Message Version a name in code was made of with `kind`, or nothing when `codeNameOf` writes no such name. */
export function messageOfCodeName(
  text: string,
  kind: MessageNameKind,
): { readonly name: string; readonly version: number } | undefined {
  const [, stem = '', digits = ''] = new RegExp(`^(.+)${kind}V([0-9]+)$`).exec(text) ?? [];
  const message = {
    name: `${stem.charAt(0).toUpperCase()}${stem.slice(1)}`,
    version: Number(digits),
  };
  return isMessageVersion(message.version) && codeNameOf(message, kind) === text
    ? message
    : undefined;
}
