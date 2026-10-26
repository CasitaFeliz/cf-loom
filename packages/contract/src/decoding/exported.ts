import type { z } from 'zod';
import type { ContractPackage } from '../declarations/index.ts';
import { type ExportedSnapshot, type SnapshotFormat, snapshotFormatOf } from '../snapshot/index.ts';
import { problemLineOf, readWith } from '../validation/index.ts';
import { exportedSnapshot } from './exported-structure.ts';
import { formatDefiner } from './texts.ts';

/** Each format's structure, which decodes what that format wrote into the model of today. */
const structures: Readonly<Record<SnapshotFormat, z.ZodType<ExportedSnapshot>>> = {
  1: exportedSnapshot,
};

/** The exported Snapshots already read, by the object a Contract Package carries, so each is read once. */
const read = new WeakMap<object, ExportedSnapshot>();

/**
 * The exported Snapshot a Provider's Contract Package carries, read by the format it names, once
 * per Snapshot; a format this cf-loom does not read, or a Snapshot its format does not describe,
 * throws rather than being read as far as it goes.
 */
export function providedSnapshotOf(
  provider: Pick<ContractPackage, 'name' | 'exportedSnapshot'>,
): ExportedSnapshot {
  const { exportedSnapshot: carried } = provider;
  const known = typeof carried === 'object' && carried !== null ? read.get(carried) : undefined;
  if (known !== undefined) {
    return known;
  }
  const decoded = decodedFrom(provider.name, carried);
  if (typeof carried === 'object' && carried !== null) {
    read.set(carried, decoded);
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
