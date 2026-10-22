const blockSize = 512;

/** The contents of every file with a name in an archive, or why the archive cannot be read. */
export type Found =
  | { readonly kind: 'found'; readonly contents: readonly Buffer[] }
  | { readonly kind: 'broken'; readonly reason: string };

type Broken = Extract<Found, { kind: 'broken' }>;

type EntryKind = 'file' | 'extended' | 'long-name' | 'link' | 'other';

type Header = {
  readonly kind: 'header';
  readonly entryKind: EntryKind;
  readonly path: string;
  readonly data: Buffer;
  readonly next: number;
};

type Named = { readonly kind: 'file' | 'link'; readonly path: string; readonly data: Buffer };

type Step = {
  readonly kind: 'step';
  readonly extendedPath?: string | undefined;
  readonly entry?: Named;
};

const noArchive = { kind: 'broken', reason: 'is no tar archive' } as const;

/**
 * The contents of every file whose path, without its first folder as npm strips it, is `name`.
 * A GNU long name, or a link with that name, is refused rather than guessed at.
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
  let extendedPath: string | undefined;
  for (;;) {
    const header = headerAt(archive, offset);
    if (header.kind !== 'header') {
      return header.kind === 'end' ? { kind: 'walked', entries } : header;
    }
    offset = header.next;
    const step = stepOf(header, extendedPath);
    if (step.kind === 'broken') {
      return step;
    }
    extendedPath = step.extendedPath;
    if (step.entry !== undefined) {
      entries.push(step.entry);
    }
  }
}

/** What an entry does to the walk: a pax header names the path of the next entry, a file or link is kept. */
function stepOf(header: Header, pendingPath: string | undefined): Step | Broken {
  switch (header.entryKind) {
    case 'extended': {
      const records = recordsOf(header.data);
      return records === undefined
        ? noArchive
        : { kind: 'step', extendedPath: records.get('path') };
    }
    case 'long-name':
      return { kind: 'broken', reason: 'has a GNU long-name entry' };
    case 'file':
    case 'link': {
      const path = pendingPath ?? header.path;
      return { kind: 'step', entry: { kind: header.entryKind, path, data: header.data } };
    }
    case 'other':
      return { kind: 'step' };
  }
}

function withoutFirstFolder(path: string): string {
  return path.split('/').slice(1).join('/');
}

function headerAt(archive: Buffer, offset: number): Header | { kind: 'end' } | Broken {
  const block = archive.subarray(offset, offset + blockSize);
  if (block.length === 0 || block.every((byte) => byte === 0)) {
    return { kind: 'end' };
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
    data: archive.subarray(start, start + size),
    next: start + Math.ceil(size / blockSize) * blockSize,
  };
}

function entryKindOf(typeflag: string): EntryKind {
  switch (typeflag) {
    case '0':
    case '\0':
      return 'file';
    case 'x':
      return 'extended';
    case 'L':
    case 'K':
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

/** The `key=value` records of a pax header, each led by its own length; a record that breaks that is none. */
function recordsOf(data: Buffer): ReadonlyMap<string, string> | undefined {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const digits = space === -1 ? '' : data.subarray(offset, space).toString('latin1');
    const end = offset + Number(digits);
    const record = data.subarray(space + 1, end - 1).toString('utf8');
    const equals = record.indexOf('=');
    const isWhole =
      /^\d+$/.test(digits) && end > space + 1 && end <= data.length && data[end - 1] === 0x0a;
    if (!isWhole || equals === -1) {
      return undefined;
    }
    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset = end;
  }
  return records;
}
