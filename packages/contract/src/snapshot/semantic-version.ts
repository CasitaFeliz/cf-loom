const semanticVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** The numbers of a semantic version and its prerelease identifiers, as text; its build orders nothing. */
export type SemanticVersionParts = {
  readonly core: readonly [string, string, string];
  readonly prerelease: readonly string[];
};

/** How far a publish moves a version: the number it raises, the numbers below it going back to 0. */
export type VersionBump = 'major' | 'minor' | 'patch';

/** Whether a value is a semantic version, a prerelease or a build included, as `publish` writes `version`. */
export function isSemanticVersion(value: unknown): value is string {
  return typeof value === 'string' && semanticVersion.test(value);
}

/**
 * The parts of a semantic version, so the arithmetic on versions needs no second grammar. The
 * version must be a semantic version, which `isSemanticVersion` tells.
 */
export function semanticVersionPartsOf(version: string): SemanticVersionParts {
  const match = semanticVersion.exec(version);
  if (match === null) {
    throw new Error(`${version} is no semantic version: a bug.`);
  }
  const [, major = '', minor = '', patch = '', prerelease] = match;
  return {
    core: [major, minor, patch],
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  };
}

/**
 * The part of a semantic version a caret range on it keeps fixed, as npm reads `^`: its major, else
 * `0.minor`, else `0.0.patch`, so two carets admit one line of versions only when theirs agree.
 */
export function caretLineOf(version: string): string {
  const [major, minor, patch] = semanticVersionPartsOf(version).core;
  if (major !== '0') {
    return major;
  }
  return minor === '0' ? `0.0.${patch}` : `0.${minor}`;
}
