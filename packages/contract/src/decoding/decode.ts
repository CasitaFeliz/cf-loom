import type { z } from 'zod';
import {
  canonicalSnapshotOf,
  deepestPathOf,
  type NamedFormat,
  type PublishedSnapshot,
  type SnapshotFormat,
  snapshotFormatOf,
  snapshotNestingLimit,
} from '../snapshot/index.ts';
import { problemOf } from '../validation/index.ts';
import { heldProblemOf } from './references.ts';
import { publishedSnapshot } from './structure.ts';

/** A `snapshot.json` as decoded: the published Snapshot, or why it cannot be trusted. */
export type DecodedSnapshot =
  | { readonly kind: 'decoded'; readonly snapshot: PublishedSnapshot }
  | { readonly kind: 'no-json'; readonly reason: string }
  | Exclude<NamedFormat, { kind: 'known' }>;

/** Each format's structure, which decodes what that format wrote into the model of today. */
const structures: Readonly<Record<SnapshotFormat, z.ZodType<PublishedSnapshot>>> = {
  1: publishedSnapshot,
};

/**
 * A `snapshot.json` from the registry, decoded by the format it names into the published Snapshot
 * in canonical order; JSON nested past the Snapshot's limit, anything its format does not define,
 * a name it uses and does not hold, or a def that leads back to itself with no node between, is
 * refused rather than read as far as it goes.
 */
export function decodeSnapshot(text: string): DecodedSnapshot {
  const parsed = parsedJsonOf(text);
  if (parsed.kind === 'no-json') {
    return parsed;
  }
  const format = snapshotFormatOf(parsed.json);
  if (format.kind !== 'known') {
    return format;
  }
  const tooDeep = deepestPathOf(parsed.json, snapshotNestingLimit);
  if (tooDeep !== undefined) {
    const reason = `nests deeper than ${snapshotNestingLimit} levels`;
    return { kind: 'malformed', at: tooDeep, reason };
  }
  return decodedWithinStack(structures[format.format], parsed.json);
}

type Parsed =
  | { readonly kind: 'json'; readonly json: unknown }
  | Extract<DecodedSnapshot, { kind: 'no-json' }>;

function parsedJsonOf(text: string): Parsed {
  try {
    return { kind: 'json', json: JSON.parse(text) };
  } catch (e) {
    return { kind: 'no-json', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** A Snapshot the stack or a string cannot hold is malformed: the decoder never throws for a file. */
function decodedWithinStack(
  structure: z.ZodType<PublishedSnapshot>,
  json: unknown,
): DecodedSnapshot {
  try {
    return decodedBy(structure, json);
  } catch (e) {
    if (e instanceof RangeError) {
      return { kind: 'malformed', at: [], reason: 'is too large or nests too deeply to decode' };
    }
    throw e;
  }
}

function decodedBy(structure: z.ZodType<PublishedSnapshot>, json: unknown): DecodedSnapshot {
  const structured = structure.safeParse(json);
  if (!structured.success) {
    return { kind: 'malformed', ...problemOf(structured.error.issues, 'its format') };
  }
  const problem = heldProblemOf(structured.data);
  if (problem !== undefined) {
    return { kind: 'malformed', ...problem };
  }
  return { kind: 'decoded', snapshot: canonicalSnapshotOf(structured.data) };
}
