declare const token: unique symbol;

/**
 * A text as it stands on a line: one item no reader of the line splits, since every text from
 * outside cf-loom in it was written by a writer that returns a Token, or is a literal of cf-loom's
 * own. See Runtime in the root ARCHITECTURE.md.
 */
export type Token = string & { readonly [token]: true };

/** A text a line takes as one item: a Token, or a literal of cf-loom's own; a wide `string` is a Token it lacks. */
export type Listable<Name> = Name extends Token
  ? Name
  : Name extends string
    ? Record<never, never> extends Record<Name, true>
      ? Token
      : Name
    : Token;

/** What an item of a list or a record may be on a line without quotes: no separator and no line break. */
const itemText = /^[A-Za-z0-9_@/$.:+~-]+$/;

/** What a key of a path may be on a line without quotes: an item's characters but the dot that separates keys. */
const keyText = /^[A-Za-z0-9_@/$-]+$/;

/**
 * A text from outside cf-loom as an item of a list or a record: itself when made of the item
 * class and not a bare closing word, else as JSON.
 */
export function wordOf(text: string): Token {
  const isPlain = itemText.test(text) && text !== 'and' && text !== 'or';
  return (isPlain ? text : JSON.stringify(text)) as Token;
}

/** A text as a key of a path stands on a line: itself when made of the path class, else as JSON. */
export function tokenOf(text: string): Token {
  return (keyText.test(text) ? text : JSON.stringify(text)) as Token;
}

/** Words of one item, separated by spaces: `orderPlaced svc.event.OrderCreated.v1 o-1`. */
export function wordsOf<const Words extends readonly string[]>(
  words: Words & { readonly [Position in keyof Words]: Listable<Words[Position]> },
): Token {
  return words.join(' ') as Token;
}

/** A path of keys and positions on a line, joined by dots, each key as `tokenOf` writes it: `body.items.0."a.b"`. */
export function dottedPathOf(path: readonly (string | number)[]): Token {
  return path.map((step) => tokenOf(String(step))).join('.') as Token;
}
