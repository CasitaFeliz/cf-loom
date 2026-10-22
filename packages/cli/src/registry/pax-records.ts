type PaxRecord = { readonly key: string; readonly value: string; readonly end: number };

/** The `key=value` records of a pax header, each led by its own length; a record that breaks that is none. */
export function recordsOf(data: Buffer): ReadonlyMap<string, string> | undefined {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const record = recordAt(data, offset);
    if (record === undefined) {
      return undefined;
    }
    records.set(record.key, record.value);
    offset = record.end;
  }
  return records;
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
