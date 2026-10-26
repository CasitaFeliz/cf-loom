import type { z } from 'zod';
import { carriedCutOf, type Endpoint, providerOf } from '../declarations/index.ts';
import { type ExportedSnapshot, type SnapshotFormat, snapshotFormatOf } from '../snapshot/index.ts';
import { problemLineOf, readWith } from '../validation/index.ts';
import { exportedSnapshot } from './exported-structure.ts';
import { formatDefiner } from './texts.ts';

/** Each format's structure, which decodes what that format wrote into the model of today. */
const structures: Readonly<Record<SnapshotFormat, z.ZodType<ExportedSnapshot>>> = {
  1: exportedSnapshot,
};

/** The exported Snapshot cuts already read, by the object an Endpoint carries, so each is read once. */
const decodedByCarried = new WeakMap<object, ExportedSnapshot>();

/**
 * The exported Snapshot cut to a Provided Endpoint, which it carries, read by the format it names,
 * once per cut; a format this cf-loom does not read, or a cut its format does not describe, throws
 * rather than being read as far as it goes.
 */
export function providedSnapshotOf(endpoint: Endpoint): ExportedSnapshot {
  const provider = providerOf(endpoint);
  if (provider === undefined) {
    throw new Error(
      `${endpoint.name} is no Endpoint a Contract Package exports, so it carries no exported Snapshot`,
    );
  }
  const carried = carriedCutOf(endpoint);
  const known =
    typeof carried === 'object' && carried !== null ? decodedByCarried.get(carried) : undefined;
  if (known !== undefined) {
    return known;
  }
  const decoded = decodedFrom(provider, carried);
  if (typeof carried === 'object' && carried !== null) {
    decodedByCarried.set(carried, decoded);
  }
  return decoded;
}

function decodedFrom(provider: string, carried: unknown): ExportedSnapshot {
  const named = snapshotFormatOf(carried);
  const exported = `${provider}'s exported Snapshot`;
  switch (named.kind) {
    case 'newer-format':
      throw new Error(
        `${exported} is in format ${named.format}, newer than this cf-loom reads: upgrade the @cf-loom packages`,
      );
    case 'malformed':
      throw new Error(`${exported} is malformed: ${problemLineOf(named)}`);
    case 'known': {
      const structured = readWith(structures[named.format], carried, formatDefiner);
      if (structured.kind === 'refused') {
        throw new Error(`${exported} is malformed: ${problemLineOf(structured.problems[0])}`);
      }
      return structured.value;
    }
  }
}
