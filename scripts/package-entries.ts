import { posix } from 'node:path';

/** A package's entry files and their folders, as paths under `src/` relative to the package. */
export type Entries = {
  readonly files: ReadonlySet<string>;
  readonly bins: ReadonlySet<string>;
  readonly folders: ReadonlySet<string>;
};

/** A package's entries, or the wildcard subpath that makes them impossible to list. */
export type PackageEntries =
  | { readonly kind: 'entries'; readonly entries: Entries }
  | { readonly kind: 'wildcard' };

/** The sources under `src/` of the files a package's `exports` and `bin` point at in `dist/`. */
export function entriesOf(manifest: { exports?: unknown; bin?: unknown }): PackageEntries {
  const exported = targetsOf(manifest.exports);
  const binTargets = targetsOf(manifest.bin);
  if ([...exported, ...binTargets].some((target) => target.includes('*'))) {
    return { kind: 'wildcard' };
  }
  const bins = binTargets.map(sourceOf).filter(isPath);
  const files = new Set([...exported.map(sourceOf).filter(isPath), ...bins]);
  const folders = new Set([...files].map((file) => posix.dirname(file)));
  return { kind: 'entries', entries: { files, bins: new Set(bins), folders } };
}

function targetsOf(field: unknown): string[] {
  if (typeof field === 'string') {
    return [field];
  }
  if (typeof field !== 'object' || field === null) {
    return [];
  }
  return Object.values(field).flatMap(targetsOf);
}

/** A target outside `dist/`, such as `./package.json`, is not built from `src/` and is no entry. */
function sourceOf(target: string): string | undefined {
  const path = posix.normalize(target);
  if (!path.startsWith('dist/')) {
    return undefined;
  }
  return `src/${path.slice('dist/'.length).replace(/(?:\.d\.ts|\.js)$/, '.ts')}`;
}

function isPath(path: string | undefined): path is string {
  return path !== undefined;
}
