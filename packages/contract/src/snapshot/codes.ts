import {
  invalidInputBody,
  type StandardRejectionName,
  standardRejectionNames,
} from '../declarations/index.ts';
import type { ResolvedStandard, ValidatedCode } from '../validation/index.ts';
import { byCodePoint, type SchemaNode, walkSchemas } from '../walker/index.ts';
import type { ResolvedDefinitions, SnapshotSources } from './context.ts';
import { listedOriginOf, standardOriginOf } from './origins.ts';
import type {
  CodeSnapshot,
  StandardRejectionSnapshot,
  StandardRejectionsSnapshot,
} from './types.ts';

/** Codes once each, by code point, as the Snapshot lists an Endpoint's or a Guard's codes. */
export function sortedCodes(codes: readonly string[]): readonly string[] {
  return [...new Set(codes)].sort(byCodePoint);
}

/** The code a Standard Rejection resolves to in this root. */
export function codeOfStandard(
  standards: readonly ResolvedStandard[],
  name: StandardRejectionName,
): string {
  return standardNamed(standards, name).code;
}

/** Each Standard Rejection resolved with its origin; only the invalid-input one has a body. */
export function standardRejectionsOf({
  standards,
  packages,
}: SnapshotSources): StandardRejectionsSnapshot {
  const entries = standardRejectionNames.map(
    (name) => [name, standardRejectionOf(standardNamed(standards, name), packages)] as const,
  );
  return Object.fromEntries(entries) as StandardRejectionsSnapshot;
}

/**
 * The codes a root reaches with their first declaration, then every Standard Rejection's code;
 * none is removed, since only the Baseline knows a removed code.
 */
export function codeSnapshotsOf(
  codes: readonly ValidatedCode[],
  standardRejections: StandardRejectionsSnapshot,
  sources: SnapshotSources,
): Readonly<Record<string, CodeSnapshot>> {
  const declared = codes.filter(({ reached }) => reached).map((code) => codeOf(code, sources));
  const standard = Object.values(standardRejections).map(
    ({ code, origin, status, message, body }) =>
      [code, { origin, status, message, body: body ?? null, removed: false }] as const,
  );
  return Object.fromEntries([...declared, ...standard]);
}

function standardNamed(
  standards: readonly ResolvedStandard[],
  name: StandardRejectionName,
): ResolvedStandard {
  const standard = standards.find((resolved) => resolved.name === name);
  if (standard === undefined) {
    throw new Error(`A valid root resolves every Standard Rejection: ${name} is missing, a bug.`);
  }
  return standard;
}

function codeOf(
  { code, rejection, listedIn }: ValidatedCode,
  { nodeOf, packages }: SnapshotSources,
): readonly [string, CodeSnapshot] {
  const origin = listedOriginOf(listedIn, packages);
  const { status, message } = rejection;
  const body = nodeOf(rejection, 'body') ?? null;
  return [code, { origin, status, message, body, removed: false }];
}

function standardRejectionOf(
  standard: ResolvedStandard,
  packages: readonly ResolvedDefinitions[],
): StandardRejectionSnapshot {
  const { name, code, status, message } = standard;
  const origin = standardOriginOf(standard, packages);
  if (name !== 'invalidInput') {
    return { origin, code, status, message };
  }
  return { origin, code, status, message, body: invalidInputNode() };
}

function invalidInputNode(): SchemaNode {
  const at = ['standardRejections', 'invalidInput', 'body'];
  const [located] = walkSchemas([{ at, schema: invalidInputBody }], () => undefined).located;
  if (located?.walked.kind !== 'walked') {
    throw new Error('cf-loom’s invalid-input body walks to a node: a bug.');
  }
  return located.walked.value;
}
