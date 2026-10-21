import { byCodePoint } from '../walker/index.ts';

const semanticVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** The numbers of a semantic version and its prerelease identifiers; its build orders nothing. */
type Parts = { readonly core: readonly number[]; readonly prerelease: readonly string[] };

/** Whether a value is a semantic version, a prerelease or a build included, as `publish` writes `version`. */
export function isSemanticVersion(value: unknown): value is string {
  return typeof value === 'string' && semanticVersion.test(value);
}

/**
 * How two semantic versions order, as semver.org orders them: negative when the first is lower,
 * zero when neither is, positive when it is higher. Both must be semantic versions, which
 * `isSemanticVersion` tells.
 */
export function compareSemanticVersions(left: string, right: string): number {
  const leftParts = partsOf(left);
  const rightParts = partsOf(right);
  const byCore = compareEach(leftParts.core, rightParts.core, (first, second) => first - second);
  return byCore === 0 ? comparePrereleases(leftParts.prerelease, rightParts.prerelease) : byCore;
}

function partsOf(version: string): Parts {
  const match = semanticVersion.exec(version);
  if (match === null) {
    throw new Error(`${version} is no semantic version: a bug.`);
  }
  const [, major = '', minor = '', patch = '', prerelease] = match;
  return {
    core: [major, minor, patch].map(Number),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  };
}

/** A version with no prerelease is higher than the same version with one. */
function comparePrereleases(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return right.length - left.length;
  }
  return compareEach(left, right, compareIdentifiers);
}

/** Numeric identifiers order by number and come before the others, which order by code point. */
function compareIdentifiers(left: string, right: string): number {
  const leftIsNumeric = /^\d+$/.test(left);
  const rightIsNumeric = /^\d+$/.test(right);
  if (leftIsNumeric && rightIsNumeric) {
    return Number(left) - Number(right);
  }
  if (leftIsNumeric || rightIsNumeric) {
    return leftIsNumeric ? -1 : 1;
  }
  return byCodePoint(left, right);
}

/** The first difference of two lists, else the shorter is lower. */
function compareEach<Value>(
  left: readonly Value[],
  right: readonly Value[],
  compare: (first: Value, second: Value) => number,
): number {
  for (const [index, first] of left.entries()) {
    const second = right[index];
    const difference = second === undefined ? 0 : compare(first, second);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}
