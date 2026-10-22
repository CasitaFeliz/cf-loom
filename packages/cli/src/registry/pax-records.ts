import { type Broken, noArchive, paxNotWritten } from './tar-broken.ts';

const maxPaxBytes = 1024 * 1024;

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

type PaxRecord = { readonly key: string; readonly value: string; readonly end: number };

type Records = { readonly kind: 'records'; readonly records: ReadonlyMap<string, string> };

/** A pax header of at most a mebibyte holding each of `path`, `mtime` and `size` at most once. */
export function paxOf(data: Buffer): Pax | Broken {
  if (data.length > maxPaxBytes) {
    return paxNotWritten;
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
    if (record === undefined) {
      return noArchive;
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

function recordAt(data: Buffer, offset: number): PaxRecord | undefined {
  const space = data.indexOf(0x20, offset);
  if (space === -1) {
    return undefined;
  }
  const digits = data.subarray(offset, space).toString('latin1');
  const end = offset + Number(digits);
  const isWhole = /^\d+$/.test(digits) && end > space + 1 && end <= data.length;
  if (!isWhole || data[end - 1] !== 0x0a) {
    return undefined;
  }
  const record = data.subarray(space + 1, end - 1).toString('utf8');
  const equals = record.indexOf('=');
  if (equals === -1) {
    return undefined;
  }
  return { key: record.slice(0, equals), value: record.slice(equals + 1), end };
}
