import { byCodePoint, semanticVersionPartsOf, type VersionBump } from '@cf-loom/contract/internal';

/**
 * Whether a semantic version is a prerelease, which is never the highest stable version; a hyphen
 * in its build does not make one. It must be a semantic version, which `isSemanticVersion` tells.
 */
export function isPrerelease(version: string): boolean {
  return semanticVersionPartsOf(version).prerelease.length > 0;
}

/**
 * How two semantic versions order, as semver.org orders them: negative when the first is lower,
 * zero when neither is, positive when it is higher. Both must be semantic versions, which
 * `isSemanticVersion` tells.
 */
export function compareSemanticVersions(left: string, right: string): number {
  const leftParts = semanticVersionPartsOf(left);
  const rightParts = semanticVersionPartsOf(right);
  const byCore = compareEach(leftParts.core, rightParts.core, compareNumbers);
  return byCore === 0 ? comparePrereleases(leftParts.prerelease, rightParts.prerelease) : byCore;
}

/** A semantic version's numbers alone, with no prerelease and no build. It must be a semantic version, which `isSemanticVersion` tells. */
export function numbersOf(version: string): string {
  return semanticVersionPartsOf(version).core.join('.');
}

/**
 * The semantic version a bump moves a version to: the number it raises, the numbers below it back
 * to 0, and no prerelease or build. The version must be a semantic version, which
 * `isSemanticVersion` tells.
 */
export function bumpedVersionOf(version: string, bump: VersionBump): string {
  const [major, minor, patch] = semanticVersionPartsOf(version).core;
  switch (bump) {
    case 'major':
      return `${BigInt(major) + 1n}.0.0`;
    case 'minor':
      return `${major}.${BigInt(minor) + 1n}.0`;
    case 'patch':
      return `${major}.${minor}.${BigInt(patch) + 1n}`;
  }
}

/**
 * The prerelease `<version>-<n>` that comes next for a version's numbers: `n` is one above the
 * highest `<version>-<n>` among the listed versions, or 0 when none is listed. Every version must
 * be a semantic version, which `isSemanticVersion` tells.
 */
export function nextPrereleaseOf(version: string, listed: readonly string[]): string {
  const numbers = numbersOf(version);
  let next = 0n;
  for (const other of listed) {
    const counter = counterOf(numbers, other);
    if (counter !== undefined && counter >= next) {
      next = counter + 1n;
    }
  }
  return `${numbers}-${next}`;
}

/** The `<n>` of a version that is `<numbers>-<n>`, with no leading zero. */
function counterOf(numbers: string, version: string): bigint | undefined {
  const { core, prerelease } = semanticVersionPartsOf(version);
  if (prerelease.length !== 1 || core.join('.') !== numbers) {
    return undefined;
  }
  const [identifier = ''] = prerelease;
  return isNumericIdentifier(identifier) ? BigInt(identifier) : undefined;
}

/** A prerelease identifier of digits only, which a semantic version writes with no leading zero. */
function isNumericIdentifier(identifier: string): boolean {
  return /^(0|[1-9]\d*)$/.test(identifier);
}

/** A version with no prerelease is higher than the same version with one. */
function comparePrereleases(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return right.length - left.length;
  }
  return compareEach(left, right, compareIdentifiers);
}

/** Numbers have no leading zero, so the longer is the greater, and equal lengths order by digit; no double is involved. */
function compareNumbers(left: string, right: string): number {
  return left.length === right.length ? byCodePoint(left, right) : left.length - right.length;
}

/** Numeric identifiers order by number and come before the others, which order by code point. */
function compareIdentifiers(left: string, right: string): number {
  const leftIsNumeric = isNumericIdentifier(left);
  const rightIsNumeric = isNumericIdentifier(right);
  if (leftIsNumeric && rightIsNumeric) {
    return compareNumbers(left, right);
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
