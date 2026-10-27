/** Whether a value is a Message Version's version: a safe integer from 1, so its text and `version - 1` are exact. */
export function isMessageVersion(version: unknown): boolean {
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1;
}

/** A Message Version's name in code, as a type: the type twin of `codeNameOf`. */
export type CodeNameOf<Message extends { readonly name: string; readonly version: number }> =
  `${Uncapitalize<Message['name']>}V${Message['version']}`;

/** A Message Version's name in code, `orderCreatedV2`, which the Handler map's `commands` and the `readers` table key it by. */
export function codeNameOf(message: { readonly name: string; readonly version: number }): string {
  return `${message.name.charAt(0).toLowerCase()}${message.name.slice(1)}V${message.version}`;
}
