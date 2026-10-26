import {
  invalidInputBody,
  type StandardRejectionName,
  standardRejectionNames,
} from '../declarations/index.ts';
import type { ResolvedDefinitions, ValidatedCode } from '../validation/index.ts';
import { byCodePoint, type SchemaNode, walkSchemas } from '../walker/index.ts';
import type { ResolvedStandard } from '../written/index.ts';
import type { SnapshotSources } from './context.ts';
import { packageOriginOf, standardOriginOf } from './origins.ts';
import type { CodeSnapshot, StandardRejectionsSnapshot } from './types.ts';

/** Codes once each, by code point, as the Snapshot lists an Endpoint's or a Guard's codes. */
export function sortedCodes(codes: readonly string[]): readonly string[] {
  return [...new Set(codes)].sort(byCodePoint);
}

/** The code a Standard Rejection resolves to in this Root. */
export function codeOfStandard(
  standards: readonly ResolvedStandard[],
  name: StandardRejectionName,
): string {
  return standardNamed(standards, name).code;
}

/** The code each Standard Rejection resolves to in this Root. */
export function standardRejectionsOf({
  standards,
}: Pick<SnapshotSources, 'standards'>): StandardRejectionsSnapshot {
  const entries = standardRejectionNames.map(
    (name) => [name, codeOfStandard(standards, name)] as const,
  );
  return Object.fromEntries(entries) as StandardRejectionsSnapshot;
}

/**
 * The codes a Root reaches with their declaration, then every Standard Rejection's code; the
 * declared Snapshot has no removed code, since only the Baseline knows one.
 */
export function codeSnapshotsOf(
  codes: readonly ValidatedCode[],
  sources: SnapshotSources,
): Readonly<Record<string, CodeSnapshot>> {
  const declared = codes.map((code) => codeOf(code, sources));
  const standard = sources.standards.map((resolved) =>
    standardCodeOf(resolved, sources.standardRejectionsSource),
  );
  return Object.fromEntries([...declared, ...standard]);
}

function standardNamed(
  standards: readonly ResolvedStandard[],
  name: StandardRejectionName,
): ResolvedStandard {
  const standard = standards.find((resolved) => resolved.name === name);
  if (standard === undefined) {
    throw new Error(`A valid Root resolves every Standard Rejection: ${name} is missing, a bug.`);
  }
  return standard;
}

function codeOf(
  { code, rejection, from }: ValidatedCode,
  { nodeOf }: SnapshotSources,
): readonly [string, CodeSnapshot] {
  const origin = packageOriginOf(from);
  const { status, message } = rejection;
  const body = nodeOf(rejection, 'body') ?? null;
  return [code, { origin, status, message, body }];
}

function standardCodeOf(
  standard: ResolvedStandard,
  standardRejectionsSource: ResolvedDefinitions | undefined,
): readonly [string, CodeSnapshot] {
  const { name, code, status, message } = standard;
  const origin = standardOriginOf(standard, standardRejectionsSource);
  const body = name === 'invalidInput' ? invalidInputNode(code) : null;
  return [code, { origin, status, message, body }];
}

function invalidInputNode(code: string): SchemaNode {
  const at = ['codes', code, 'body'];
  const [located] = walkSchemas([{ at, schema: invalidInputBody }], () => undefined).located;
  if (located?.walked.kind !== 'walked') {
    throw new Error('cf-loom’s invalid-input body walks to a node: a bug.');
  }
  return located.walked.value;
}
