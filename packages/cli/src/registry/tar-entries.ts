import { recordsOf } from './pax-records.ts';

const blockSize = 512;

/** The contents of every file with a name in an archive, or why the archive cannot be read. */
export type Found = { readonly kind: 'found'; readonly contents: readonly Buffer[] } | Broken;

type Broken = { readonly kind: 'broken'; readonly reason: string };

type End = { readonly kind: 'end' };

type EntryKind = 'file' | 'extended' | 'long-name' | 'link' | 'other';

type Header = {
  readonly kind: 'header';
  readonly entryKind: EntryKind;
  readonly path: string;
  readonly size: number;
  readonly data: Buffer;
  readonly next: number;
};

type Named = { readonly kind: 'file' | 'link'; readonly path: string; readonly data: Buffer };

/** What a pax header says of the entry that follows it. */
type Pending = { readonly path?: string | undefined; readonly size?: string | undefined };

type Step =
  | { readonly kind: 'pax'; readonly pending: Pending; readonly next: number }
  | { readonly kind: 'entry'; readonly entry: Named; readonly next: number }
  | { readonly kind: 'skipped'; readonly next: number }
  | End
  | Broken;

const noArchive = { kind: 'broken', reason: 'is no tar archive' } as const;
const afterEnd = { kind: 'broken', reason: 'has data after its end' } as const;
const paxSize = { kind: 'broken', reason: 'has a pax size that differs from its header' } as const;
const longName = { kind: 'broken', reason: 'has a GNU long-name entry' } as const;

/**
 * The contents of every file whose path, as npm unpacks it, is `name`; an archive npm could read
 * differently than this does is refused rather than guessed at.
 */
export function entriesNamed(archive: Buffer, name: string): Found {
  const walked = entriesOf(archive);
  if (walked.kind === 'broken') {
    return walked;
  }
  const named = walked.entries.filter(({ path }) => withoutFirstFolder(path) === name);
  if (named.some((entry) => entry.kind === 'link')) {
    return { kind: 'broken', reason: `has a link named ${name}` };
  }
  return { kind: 'found', contents: named.map((entry) => entry.data) };
}

function entriesOf(archive: Buffer): { kind: 'walked'; entries: readonly Named[] } | Broken {
  const entries: Named[] = [];
  let offset = 0;
  let pending: Pending = {};
  for (;;) {
    const step = stepAt(archive, offset, pending);
    switch (step.kind) {
      case 'end':
        return { kind: 'walked', entries };
      case 'broken':
        return step;
      case 'pax':
        pending = step.pending;
        break;
      case 'entry':
        entries.push(step.entry);
        pending = {};
        break;
      case 'skipped':
        pending = {};
        break;
    }
    offset = step.next;
  }
}

function stepAt(archive: Buffer, offset: number, pending: Pending): Step {
  const header = headerAt(archive, offset);
  switch (header.kind) {
    case 'end':
    case 'broken':
      return header;
    case 'header':
      return stepOf(header, pending);
  }
}

/** What an entry does to the walk: a pax header names the next entry's path, a file or link is kept. */
function stepOf(header: Header, pending: Pending): Step {
  switch (header.entryKind) {
    case 'extended':
      return paxStepOf(header);
    case 'long-name':
      return longName;
    case 'file':
    case 'link':
    case 'other':
      return entryStepOf(header, pending);
  }
}

function paxStepOf({ data, next }: Header): Step {
  const records = recordsOf(data);
  if (records === undefined) {
    return noArchive;
  }
  return { kind: 'pax', pending: { path: records.get('path'), size: records.get('size') }, next };
}

function entryStepOf(header: Header, pending: Pending): Step {
  const { entryKind, data, next } = header;
  if (pending.size !== undefined && pending.size !== `${header.size}`) {
    return paxSize;
  }
  if (entryKind !== 'file' && entryKind !== 'link') {
    return { kind: 'skipped', next };
  }
  const path = pending.path ?? header.path;
  return { kind: 'entry', entry: { kind: entryKind, path, data }, next };
}

/** A path as npm unpacks it: its first folder stripped, then empty and `.` segments dropped. */
function withoutFirstFolder(path: string): string {
  const segments = path.split('/').slice(1);
  return segments.filter((segment) => segment !== '' && segment !== '.').join('/');
}

function headerAt(archive: Buffer, offset: number): Header | End | Broken {
  const block = archive.subarray(offset, offset + blockSize);
  if (block.every((byte) => byte === 0)) {
    return endAt(archive, offset);
  }
  const size = octalOf(block.subarray(124, 136));
  const isWhole =
    block.length === blockSize && octalOf(block.subarray(148, 156)) === checksumOf(block);
  const start = offset + blockSize;
  if (size === undefined || !isWhole || start + size > archive.length) {
    return noArchive;
  }
  return {
    kind: 'header',
    entryKind: entryKindOf(String.fromCharCode(block[156] ?? 0)),
    path: pathOf(block),
    size,
    data: archive.subarray(start, start + size),
    next: start + Math.ceil(size / blockSize) * blockSize,
  };
}

/** The archive ends at its first zero block, and nothing but zeros may follow, as npm would read on. */
function endAt(archive: Buffer, offset: number): End | Broken {
  const hasData = archive.subarray(offset).some((byte) => byte !== 0);
  return hasData ? afterEnd : { kind: 'end' };
}

function entryKindOf(typeflag: string): EntryKind {
  switch (typeflag) {
    case '0':
    case '\0':
    case '7':
      return 'file';
    case 'x':
    case 'X':
      return 'extended';
    case 'L':
    case 'K':
    case 'N':
      return 'long-name';
    case '1':
    case '2':
      return 'link';
    default:
      return 'other';
  }
}

/** The header's path: the ustar prefix and name, where the header says it is a ustar one. */
function pathOf(block: Buffer): string {
  const name = textOf(block.subarray(0, 100));
  const isUstar = block.subarray(257, 263).toString('latin1') === 'ustar\0';
  const prefix = isUstar ? textOf(block.subarray(345, 500)) : '';
  return prefix === '' ? name : `${prefix}/${name}`;
}

function textOf(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

/** An octal number as a header writes it, NUL or space padded; a base-256 size is not one. */
function octalOf(field: Buffer): number | undefined {
  const digits = field
    .toString('latin1')
    .replace(/[\0 ]+$/, '')
    .trimStart();
  return /^[0-7]+$/.test(digits) ? Number.parseInt(digits, 8) : undefined;
}

/** The sum of a header's bytes with the checksum field read as spaces. */
function checksumOf(block: Buffer): number {
  let sum = 0;
  for (const [index, byte] of block.entries()) {
    sum += index >= 148 && index < 156 ? 0x20 : byte;
  }
  return sum;
}
