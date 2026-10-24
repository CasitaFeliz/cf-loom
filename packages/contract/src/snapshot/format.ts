import type { Problem } from '../validation/index.ts';
import { ownOf } from '../written/index.ts';
import { type SnapshotFormat, snapshotFormats } from './types.ts';

/** The format a Snapshot names, read as a value, since a newer cf-loom may have written it. */
export type NamedFormat =
  | { readonly kind: 'known'; readonly format: SnapshotFormat }
  | { readonly kind: 'newer-format'; readonly format: number }
  | ({ readonly kind: 'malformed' } & Problem);

/** The format a Snapshot names: a whole number from 1 is one cf-loom knows, else a newer cf-loom wrote it. */
export function snapshotFormatOf(snapshot: unknown): NamedFormat {
  const format = ownOf(snapshot, 'format');
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return { kind: 'malformed', at: ['format'], reason: 'is not a whole number from 1' };
  }
  const known = snapshotFormats.find((candidate) => candidate === format);
  return known === undefined ? { kind: 'newer-format', format } : { kind: 'known', format: known };
}
