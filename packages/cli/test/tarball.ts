import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const block = 512;

/** One entry of a tar archive, with the fields a test may write wrongly on purpose. */
export type TarEntry = {
  readonly path: string;
  readonly content?: Buffer | string;
  readonly type?: string;
  readonly prefix?: string;
  readonly linkname?: string;
  readonly ustar?: string;
  readonly corruptChecksum?: boolean;
  readonly sizeField?: Buffer;
  readonly sizeAs?: (size: number) => string;
  readonly checksumAs?: (checksum: number) => string;
  readonly overwrite?: Overwrite;
};

/** Bytes written over a header at an offset, after the header is built. */
export type Overwrite = { readonly at: number; readonly bytes: Buffer };

export const octal = (number: number, digits: number) => number.toString(8).padStart(digits, '0');

function headerOf(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(block);
  header.write(entry.path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 'latin1');
  header.write('0000000\0', 108, 'latin1');
  header.write('0000000\0', 116, 'latin1');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  entry.sizeField?.copy(header, 124);
  if (entry.sizeAs !== undefined) {
    header.write(entry.sizeAs(size), 124, 12, 'latin1');
  }
  header.write('00000000000\0', 136, 'latin1');
  header.write('        ', 148, 'latin1');
  header.write(entry.type ?? '0', 156, 'latin1');
  header.write(entry.linkname ?? '', 157, 100, 'utf8');
  header.write(entry.ustar ?? 'ustar\x0000', 257, 'latin1');
  header.write(entry.prefix ?? '', 345, 155, 'utf8');
  entry.overwrite?.bytes.copy(header, entry.overwrite.at);
  let checksum = entry.corruptChecksum ? 1 : 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumField = entry.checksumAs?.(checksum) ?? `${octal(checksum, 6)}\0 `;
  header.write(checksumField, 148, 8, 'latin1');
  return header;
}

export function tarOf(entries: readonly TarEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => {
    const content = Buffer.from(entry.content ?? '');
    const padding = Buffer.alloc((block - (content.length % block)) % block);
    return [headerOf(entry, content.length), content, padding];
  });
  return Buffer.concat([...blocks, Buffer.alloc(2 * block)]);
}

export function aTarball(entries: readonly TarEntry[]): Buffer {
  return gzipSync(tarOf(entries));
}

/** The tarball `npm pack` writes for a package whose `snapshot.json` holds the text given. */
export function aPackageTarball(snapshotJson: Buffer | string, folder = 'package'): Buffer {
  return aTarball([
    { path: `${folder}/package.json`, content: '{}' },
    { path: `${folder}/snapshot.json`, content: snapshotJson },
    { path: `${folder}/dist/index.js`, content: 'export {};' },
  ]);
}

export function integrityOf(bytes: Buffer, algorithm: 'sha1' | 'sha512'): string {
  return `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
}
