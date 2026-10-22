import { foldedCase, unpackedPathOf } from './entry-path.ts';
import { type Pax, paxOf } from './pax-records.ts';
import { type Broken, paxNotWritten } from './tar-broken.ts';
import { type Header, headerAt } from './tar-header.ts';

/** The one file with a name in an archive, none, more than one, or why the archive cannot be read. */
export type Found =
  | { readonly kind: 'found'; readonly contents: Buffer }
  | { readonly kind: 'missing' }
  | { readonly kind: 'repeated' }
  | Broken;

type Named = {
  readonly holds: 'file' | 'folder';
  readonly path: string;
  readonly folded: string;
  readonly data: Buffer;
};

type Step =
  | { readonly kind: 'pax'; readonly pax: Pax }
  | { readonly kind: 'entry'; readonly entry: Named }
  | Broken;

/**
 * The one file npm unpacks as `name`, read only from an archive as `npm pack` writes it (and
 * `pnpm pack`, when every path fits a ustar header), for printable-ASCII paths without `:` or `\`:
 * files, empty folders and one pax header of ASCII bytes with a path, a modification time and a size
 * before an entry. Anything else is refused, since npm's tar could unpack it to other files than
 * this reads.
 */
export function fileNamed(archive: Buffer, name: string): Found {
  const walked = entriesOf(archive);
  if (walked.kind === 'broken') {
    return walked;
  }
  const wanted = foldedCase(name);
  const isFolder = ({ holds, folded }: Named) =>
    folded.startsWith(`${wanted}/`) || (holds === 'folder' && folded === wanted);
  if (walked.entries.some(isFolder)) {
    return { kind: 'broken', reason: `has a folder named ${name}` };
  }
  const named = walked.entries.filter(({ folded }) => folded === wanted);
  const [only] = named;
  if (named.length > 1) {
    return { kind: 'repeated' };
  }
  return only?.path === name ? { kind: 'found', contents: only.data } : { kind: 'missing' };
}

function entriesOf(archive: Buffer): { kind: 'walked'; entries: readonly Named[] } | Broken {
  const entries: Named[] = [];
  let pending: Pax | undefined;
  let offset = 0;
  for (;;) {
    const header = headerAt(archive, offset);
    if (header.kind === 'broken') {
      return header;
    }
    if (header.kind === 'end') {
      return pending === undefined ? { kind: 'walked', entries } : paxNotWritten;
    }
    const step = stepOf(header, pending);
    switch (step.kind) {
      case 'broken':
        return step;
      case 'pax':
        pending = step.pax;
        break;
      case 'entry':
        entries.push(step.entry);
        pending = undefined;
        break;
    }
    offset = header.next;
  }
}

/** What a header does to the walk: a pax header names the next entry's path, a file or folder is kept. */
function stepOf(header: Header, pending: Pax | undefined): Step {
  if (header.holds !== 'pax') {
    return entryStepOf(header, header.holds, pending);
  }
  if (pending !== undefined) {
    return paxNotWritten;
  }
  const pax = paxOf(header.data);
  return pax.kind === 'broken' ? pax : { kind: 'pax', pax };
}

function entryStepOf(header: Header, holds: 'file' | 'folder', pending: Pax | undefined): Step {
  const { path, size, data } = header;
  if (pending?.size !== undefined && pending.size !== `${size}`) {
    return paxNotWritten;
  }
  const unpacked = unpackedPathOf(pending?.path ?? path, holds);
  if (unpacked.kind === 'broken') {
    return unpacked;
  }
  const folded = foldedCase(unpacked.path);
  return { kind: 'entry', entry: { holds, path: unpacked.path, folded, data } };
}
