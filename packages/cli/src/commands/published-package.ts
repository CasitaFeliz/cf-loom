import { join } from 'node:path';
import type {
  PeerRanges,
  PublishedDefinitionsSnapshot,
  PublishedSnapshot,
} from '@cf-loom/contract/internal';
import { type Building, type Built, builtWithTsc } from '../building/index.ts';
import type { Failed } from '../child-process/index.ts';
import {
  contractPackageFilesOf,
  definitionsManifestOf,
  type PackageFile,
  packagePaths,
} from '../contract-package/index.ts';
import { type InstalledPackage, publishedNameOf } from '../loading/index.ts';
import type { BuiltProject, Project } from '../project/index.ts';
import {
  type FirstListing,
  type NpmPlace,
  type Publishing,
  packedPathsOf,
  publishFolder,
  unchangedSince,
} from '../registry/index.ts';
import type { DistTag } from '../versioning/index.ts';
import { type CopiedFile, removeStaged, stagedIn } from '../writing/index.ts';
import { checkedEntryOf, type EntryToCheck } from './built-entry.ts';
import type { Run } from './run.ts';

/** What a publish does with the package it built: puts it out, or stops before `npm publish`. */
export type PublishMode = 'publish' | 'dry-run';

/**
 * What a publish puts out: the package's Snapshot as published with its text, the declared
 * Snapshot it was published from, the peer ranges it declares, its dist-tag, the highest
 * version the package listed when the Baseline was read, and whether it is put out at all.
 */
export type ToPublish = {
  readonly mode: PublishMode;
  readonly project: Project;
  readonly declared: Pick<BuiltProject, 'text'>;
  readonly published: PublishedSnapshot;
  readonly text: string;
  readonly peerRanges: PeerRanges;
  readonly tag: DistTag;
  readonly highest: string | undefined;
};

/** How a publish ends: the version put, or built and left unput on a dry run, or why not, and the lines naming a staging folder it could not remove. */
export type PublishedPackage = {
  readonly put: { readonly kind: 'published' | 'built' } | Failed;
  readonly left: readonly string[];
};

/** The files a package is staged from: those written, and those of the project copied as they are. */
type StagedFiles = {
  readonly kind: 'files';
  readonly files: readonly PackageFile[];
  readonly copied: readonly CopiedFile[];
};

/** What a Definitions Package is published as: its Snapshot as published with its text, and the peer ranges it declares. */
type DefinitionsToStage = {
  readonly published: PublishedDefinitionsSnapshot;
  readonly text: string;
  readonly peerRanges: PeerRanges;
};

/** What turns a staged folder into the package to publish, with what it needs: cf-loom's `tsc` on a Service's Contract Package, a check of the entry its author built on a Definitions Package, nothing on an Application's, which has no code. */
type Build =
  | { readonly kind: 'with-tsc'; readonly building: Building }
  | { readonly kind: 'by-author'; readonly entry: EntryToCheck }
  | { readonly kind: 'none' };

/** A staged folder, as it is built or checked, as it is published, and as the package was listed before the Check. */
type StagedPackage = {
  readonly mode: PublishMode;
  readonly build: Build;
  readonly publishing: Publishing;
  readonly listing: FirstListing;
};

/**
 * Stages the package of a published Snapshot inside the project, builds a Contract Package there
 * with the project's own TypeScript, publishes it through the organization's npm and removes the
 * staging folder, whatever the outcome; a folder that cannot be removed is named, not thrown.
 */
export async function publishedPackageOf(
  run: Run,
  toPublish: ToPublish,
): Promise<PublishedPackage> {
  const { project } = toPublish;
  const npm = { directory: project.directory, env: run.env };
  const name = publishedNameOf(project.packageName, toPublish.published.kind);
  const files = await stagedFilesOf(npm, name, toPublish);
  if (files.kind === 'failed') {
    return { put: files, left: [] };
  }
  const staged = stagedIn(project.directory, name, files);
  if (staged.kind === 'failed') {
    return { put: staged, left: staged.left };
  }
  let put: PublishedPackage['put'];
  let left: readonly string[];
  try {
    put = await builtAndPublished(npm, stagedPackageOf(staged, toPublish));
  } finally {
    left = removeStaged(staged.staging, project.directory);
  }
  return { put, left };
}

function stagedPackageOf(
  staged: InstalledPackage,
  { mode, project, declared, published, tag, highest }: ToPublish,
): StagedPackage {
  const { packageName, folder } = staged;
  const { version } = published;
  const publishing = { folder, packageName, version, tag };
  const listing = { packageName, highest };
  switch (published.kind) {
    case 'service': {
      const rootPath = join(project.directory, project.rootFile);
      const building = { folder, rootPath, spec: `${packageName}@${version}` };
      return { mode, build: { kind: 'with-tsc', building }, publishing, listing };
    }
    case 'application':
      return { mode, build: { kind: 'none' }, publishing, listing };
    case 'definitions': {
      const entry = { project, staged, declared };
      return { mode, build: { kind: 'by-author', entry }, publishing, listing };
    }
  }
}

async function builtAndPublished(
  npm: NpmPlace,
  { mode, build, publishing, listing }: StagedPackage,
): Promise<PublishedPackage['put']> {
  const built = await builtAs(build);
  if (built.kind === 'failed') {
    return built;
  }
  if (mode === 'dry-run') {
    return { kind: 'built' };
  }
  const unchanged = await unchangedSince(npm, listing);
  return unchanged.kind === 'failed' ? unchanged : await publishFolder(npm, publishing);
}

async function builtAs(build: Build): Promise<Built> {
  switch (build.kind) {
    case 'with-tsc':
      return await builtWithTsc(build.building);
    case 'by-author':
      return await checkedEntryOf(build.entry);
    case 'none':
      return { kind: 'built' };
  }
}

async function stagedFilesOf(
  npm: NpmPlace,
  name: string,
  { project, published, text, peerRanges }: ToPublish,
): Promise<StagedFiles | Failed> {
  switch (published.kind) {
    case 'service':
    case 'application': {
      const packaging = { name, version: published.version, peerRanges };
      const files = contractPackageFilesOf({ snapshot: published, text }, packaging);
      return { kind: 'files', files, copied: [] };
    }
    case 'definitions':
      return await definitionsFilesOf(npm, project, { published, text, peerRanges });
  }
}

/** A Definitions Package's files: its own as `npm pack` lists them, with its package.json and `snapshot.json` written over. */
async function definitionsFilesOf(
  npm: NpmPlace,
  { directory, manifest: source }: Pick<Project, 'directory' | 'manifest'>,
  { published, text, peerRanges }: DefinitionsToStage,
): Promise<StagedFiles | Failed> {
  const manifest = definitionsManifestOf(source, published, { peerRanges });
  if (manifest.kind === 'unpublishable') {
    return { kind: 'failed', message: manifest.line };
  }
  const packed = await packedPathsOf(npm);
  if (packed.kind === 'failed') {
    return packed;
  }
  const copied = packed.paths.map((path) => ({ from: join(directory, path), path }));
  const files = [manifest.file, { path: packagePaths.snapshot, text }];
  return { kind: 'files', files, copied };
}
