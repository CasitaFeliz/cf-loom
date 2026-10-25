/**
 * The words code cannot declare or import a binding by: ECMAScript's reserved words, strict mode's
 * included, `eval` and `arguments`, and `handle`, which every stub imports.
 */
const reservedWords = [
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'handle',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
] as const;

/**
 * The names every object already has, and the two JavaScript calls on any object, so a client
 * method or a Handler under one is called by plain JavaScript.
 */
const objectNames = [
  'then',
  'toJSON',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
] as const;

/** The names an Endpoint, Guard or Subscription may not take. */
export const reservedNames = [...reservedWords, ...objectNames] as const;

/** A name an Endpoint, Guard or Subscription may not take. */
export type ReservedName = (typeof reservedNames)[number];
