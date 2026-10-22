import { afterEnd, type Broken, entryNotWritten, noArchive } from './tar-broken.ts';

const blockSize = 512;
const ustarMagicAndVersion = 'ustar\x0000';
const sizeForm = /^[0-7]+[\0 ]*$/;
const checksumForm = /^[0-7]+[\0 ]+$/;
const otherNumbers = [100, 108, 116, 136, 329, 337];
const timesAfterShortPrefix = [476, 488];

/** What a header says the entry holds: a file, an empty folder, or the pax header of the next entry. */
export type Holds = 'file' | 'folder' | 'pax';

/** A header npm writes, with the data after it and where the next header is. */
export type Header = {
  readonly kind: 'header';
  readonly holds: Holds;
  readonly path: string;
  readonly size: number;
  readonly data: Buffer;
  readonly next: number;
};

/** The first zero block, after which nothing but zeros is left. */
export type End = { readonly kind: 'end' };

/** The header at `offset`, if it is one npm writes: whole, its checksum right, ustar version 00. */
export function headerAt(archive: Buffer, offset: number): Header | End | Broken {
  const block = archive.subarray(offset, offset + blockSize);
  if (block.every((byte) => byte === 0)) {
    return endAt(archive, offset);
  }
  const size = octalOf(block.subarray(124, 136), sizeForm);
  const checksum = octalOf(block.subarray(148, 156), checksumForm);
  const isWhole = block.length === blockSize && checksum === checksumOf(block);
  const start = offset + blockSize;
  if (size === undefined || !isWhole || start + size > archive.length) {
    return noArchive;
  }
  const holds = holdsOf(block, size);
  if (holds === undefined) {
    return entryNotWritten;
  }
  const data = archive.subarray(start, start + size);
  return { kind: 'header', holds, path: pathOf(block), size, data, next: start + paddedSize(size) };
}

/** The archive ends at its first zero block, and nothing but zeros may follow. */
function endAt(archive: Buffer, offset: number): End | Broken {
  const hasData = archive.subarray(offset).some((byte) => byte !== 0);
  return hasData ? afterEnd : { kind: 'end' };
}

/**
 * A file, a folder of size 0 or a pax header, with the ustar magic and version, no link path, text
 * fields that end in NULs, and no base-256 number, which npm's tar reads by other rules.
 */
function holdsOf(block: Buffer, size: number): Holds | undefined {
  const isUstar = block.subarray(257, 265).toString('latin1') === ustarMagicAndVersion;
  const hasLinkPath = block.subarray(157, 257).some((byte) => byte !== 0);
  const textFields = [block.subarray(0, 100), prefixOf(block)];
  if (!isUstar || hasLinkPath || !textFields.every(isNulPadded) || hasBase256Number(block)) {
    return undefined;
  }
  switch (String.fromCharCode(block[156] ?? 0)) {
    case '0':
    case '\0':
      return 'file';
    case '5':
      return size === 0 ? 'folder' : undefined;
    case 'x':
      return 'pax';
    default:
      return undefined;
  }
}

/** The header's path: the ustar prefix and name. */
function pathOf(block: Buffer): string {
  const name = textOf(block.subarray(0, 100));
  const prefix = textOf(prefixOf(block));
  return prefix === '' ? name : `${prefix}/${name}`;
}

/** The prefix field, which ends where atime would begin unless the prefix needs that room. */
function prefixOf(block: Buffer): Buffer {
  return block.subarray(345, hasLongPrefix(block) ? 500 : 475);
}

function hasLongPrefix(block: Buffer): boolean {
  return block[475] !== 0;
}

function textOf(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function paddedSize(size: number): number {
  return Math.ceil(size / blockSize) * blockSize;
}

/** An octal number as a header writes it, its digits then NULs and spaces; base-256 is not one. */
function octalOf(field: Buffer, form: RegExp): number | undefined {
  const text = field.toString('latin1');
  return form.test(text) ? Number.parseInt(text, 8) : undefined;
}

function isNulPadded(field: Buffer): boolean {
  const end = field.indexOf(0);
  return end === -1 || field.subarray(end).every((byte) => byte === 0);
}

/** The other numbers npm's tar reads; atime and ctime share their bytes with a long prefix. */
function hasBase256Number(block: Buffer): boolean {
  const offsets = hasLongPrefix(block) ? otherNumbers : [...otherNumbers, ...timesAfterShortPrefix];
  return offsets.some((offset) => (block[offset] ?? 0) >= 0x80);
}

/** The sum of a header's bytes with the checksum field read as spaces. */
function checksumOf(block: Buffer): number {
  let sum = 0;
  for (const [index, byte] of block.entries()) {
    sum += index >= 148 && index < 156 ? 0x20 : byte;
  }
  return sum;
}
