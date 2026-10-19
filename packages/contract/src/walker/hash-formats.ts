const hashAlgorithms = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;
const hashEncodings = ['hex', 'base64', 'base64url'] as const;

/** A hash's algorithm, as `z.hash()` takes it. */
export type HashAlgorithm = (typeof hashAlgorithms)[number];

/** A hash's encoding, as `z.hash()` takes it in `enc`. */
export type HashEncoding = (typeof hashEncodings)[number];

/** A hash format, its algorithm and encoding in its name, as `z.hash()` builds it. */
export type HashFormat = `${HashAlgorithm}_${HashEncoding}`;

/** Every hash format, each algorithm with each encoding. */
export const hashFormats: readonly HashFormat[] = hashAlgorithms.flatMap((algorithm) =>
  hashEncodings.map((encoding): HashFormat => `${algorithm}_${encoding}`),
);

const hashFormatSet: ReadonlySet<string> = new Set(hashFormats);

/** Whether a format is a hash's. */
export function isHashFormat(format: string): format is HashFormat {
  return hashFormatSet.has(format);
}

/** The algorithm and encoding a hash format names, as `z.hash()` takes them. */
export function hashPartsOf(format: HashFormat): {
  readonly algorithm: HashAlgorithm;
  readonly encoding: HashEncoding;
} {
  const separator = format.indexOf('_');
  const algorithm = hashAlgorithms.find((name) => name === format.slice(0, separator));
  const encoding = hashEncodings.find((name) => name === format.slice(separator + 1));
  if (algorithm === undefined || encoding === undefined) {
    throw new Error(`${format} is no hash format`);
  }
  return { algorithm, encoding };
}
