import { type Broken, noArchive, paxBeyondAscii, paxNotWritten } from './tar-broken.ts';

const maxPaxBytes = 1024 * 1024;
const firstByteBeyondAscii = 0x80;
const lengthForm = /^[1-9][0-9]*$/;

/**
 * The keys npm writes, each with the form of its value: no value has a line break, a path is not
 * all digits, which npm's tar reads as a number, and a size is left to the entry's own header.
 */
const writtenValues: ReadonlyMap<string, RegExp> = new Map([
  ['path', /^(?!\d+$)[^\n]*$/],
  ['mtime', /^\d+(?:\.\d+)?$/],
  ['size', /^[^\n]*$/],
]);

/** What a pax header says of the entry after it: its path, and the size its header must have. */
export type Pax = {
  readonly kind: 'pax';
  readonly path: string | undefined;
  readonly size: string | undefined;
};

type PaxRecord = {
  readonly kind: 'record';
  readonly key: string;
  readonly value: string;
  readonly end: number;
};

type Records = { readonly kind: 'records'; readonly records: ReadonlyMap<string, string> };

/**
 * A pax header of at most a mebibyte, every byte below 0x80, holding each of `path`, `mtime` and
 * `size` at most once, each record led by a length that starts with a digit from 1 to 9.
 */
export function paxOf(data: Buffer): Pax | Broken {
  if (data.length > maxPaxBytes) {
    return paxNotWritten;
  }
  if (data.some((byte) => byte >= firstByteBeyondAscii)) {
    return paxBeyondAscii;
  }
  const read = recordsOf(data);
  if (read.kind === 'broken') {
    return read;
  }
  const { records } = read;
  return { kind: 'pax', path: records.get('path'), size: records.get('size') };
}

/** The `key=value` records of a pax header, each led by its own length; a record that breaks that is none. */
function recordsOf(data: Buffer): Records | Broken {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const record = recordAt(data, offset);
    if (record.kind === 'broken') {
      return record;
    }
    if (!isWritten(record, records)) {
      return paxNotWritten;
    }
    records.set(record.key, record.value);
    offset = record.end;
  }
  return { kind: 'records', records };
}

function isWritten({ key, value }: PaxRecord, earlier: ReadonlyMap<string, string>): boolean {
  return writtenValues.get(key)?.test(value) === true && !earlier.has(key);
}

function recordAt(data: Buffer, offset: number): PaxRecord | Broken {
  const space = data.indexOf(0x20, offset);
  if (space === -1) {
    return noArchive;
  }
  const digits = data.subarray(offset, space).toString('latin1');
  if (!lengthForm.test(digits)) {
    return /^\d+$/.test(digits) ? paxNotWritten : noArchive;
  }
  const end = offset + Number(digits);
  const isWhole = end > space + 1 && end <= data.length;
  if (!isWhole || data[end - 1] !== 0x0a) {
    return noArchive;
  }
  const record = data.subarray(space + 1, end - 1).toString('utf8');
  const equals = record.indexOf('=');
  if (equals === -1) {
    return noArchive;
  }
  return { kind: 'record', key: record.slice(0, equals), value: record.slice(equals + 1), end };
}
