/** Whether a value is a Message Version's version: a whole number from 1. */
export function isMessageVersion(version: unknown): boolean {
  return typeof version === 'number' && Number.isInteger(version) && version >= 1;
}

/** A Message Version's name in code, `orderCreatedV2`, which a Contract Package keys it by. */
export function codeNameOf(message: { readonly name: string; readonly version: number }): string {
  return `${message.name.charAt(0).toLowerCase()}${message.name.slice(1)}V${message.version}`;
}
