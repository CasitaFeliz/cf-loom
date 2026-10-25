import { join } from 'node:path';
import type { PublishedDefinitionsSnapshot, PublishedSnapshot } from '@cf-loom/contract/internal';
import { type Building, type Built, builtWithTsc } from '../building/index.ts';
import type { Failed } from '../child-process/index.ts';
import {
  contractPackageFilesOf,
  definitionsManifestOf,
  type PackageFile,
  type Peers,
  packagePaths,
} from '../contract-package/index.ts';
import { publishedNameOf } from '../loading/index.ts';
import type { BuiltProject, Project, Run } from '../project/index.ts';
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

/**
 * What a publish puts out: the package's Snapshot as published with its text, the declared
 * Snapshot it was published from, the peers it is built with, its dist-tag, and the highest
 * version the package listed when the Baseline was read.
 */
export type ToPublish = {
  readonly project: Project;
  readonly declared: Pick<BuiltProject, 'text' | 'context'>;
  readonly published: PublishedSnapshot;
  readonly text: string;
  readonly peers: Peers;
  readonly tag: DistTag;
  readonly highest: string | undefined;
};

/** How a publish ends: the version put or why not, and the lines naming a staging folder it could not remove. */
export type PublishedPackage = {
  readonly put: { readonly kind: 'published' } | Failed;
  readonly left: readonly string[];
};

/** Who builds a staged package: cf-loom, with the project's `tsc`, or its author before `publish`, which checks it. */
type Build = 'with-tsc' | 'by-author';

/** The files a package is staged from: those written, and those of the project copied as they are. */
type StagedFiles = {
  readonly kind: 'files';
  readonly files: readonly PackageFile[];
  readonly copied: readonly CopiedFile[];
  readonly build: Build;
};

/** What a Definitions Package is published as: its Snapshot as published with its text, and the peers it is built with. */
type DefinitionsToStage = {
  readonly published: PublishedDefinitionsSnapshot;
  readonly text: string;
  readonly peers: Peers;
};

/** A staged folder, as it is built or checked, as it is published, and as the package was listed before the Check. */
type StagedPackage = {
  readonly building: Building;
  readonly entry: EntryToCheck;
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
  const files = await stagedFilesOf(npm, toPublish);
  if (files.kind === 'failed') {
    return { put: files, left: [] };
  }
  const name = publishedNameOf(project.packageName, toPublish.published.kind);
  const staged = stagedIn(project.directory, name, files);
  if (staged.kind === 'failed') {
    return { put: staged, left: staged.left };
  }
  let put: PublishedPackage['put'];
  let left: readonly string[];
  try {
    put = await builtAndPublished(npm, files.build, stagedPackageOf(staged, toPublish));
  } finally {
    left = removeStaged(staged.staging, project.directory);
  }
  return { put, left };
}

function stagedPackageOf(
  { staging, folder }: { readonly staging: string; readonly folder: string },
  toPublish: ToPublish,
): StagedPackage {
  const { project, declared, published, tag, highest } = toPublish;
  const { directory, rootFile } = project;
  const { version } = published;
  const packageName = publishedNameOf(project.packageName, published.kind);
  const rootPath = join(directory, rootFile);
  const building = { folder, rootPath, spec: `${packageName}@${version}` };
  const publishing = { folder, packageName, version, tag };
  return {
    building,
    entry: { project, staging, declared },
    publishing,
    listing: { packageName, highest },
  };
}

async function builtAndPublished(
  npm: NpmPlace,
  build: Build,
  { building, entry, publishing, listing }: StagedPackage,
): Promise<PublishedPackage['put']> {
  const built = await builtAs(build, { building, entry });
  if (built.kind === 'failed') {
    return built;
  }
  const unchanged = await unchangedSince(npm, listing);
  return unchanged.kind === 'failed' ? unchanged : await publishFolder(npm, publishing);
}

async function builtAs(
  build: Build,
  { building, entry }: Pick<StagedPackage, 'building' | 'entry'>,
): Promise<Built> {
  switch (build) {
    case 'with-tsc':
      return await builtWithTsc(building);
    case 'by-author':
      return await checkedEntryOf(entry);
  }
}

async function stagedFilesOf(
  npm: NpmPlace,
  { project, published, text, peers }: ToPublish,
): Promise<StagedFiles | Failed> {
  switch (published.kind) {
    case 'service':
    case 'application': {
      const name = publishedNameOf(project.packageName, published.kind);
      const packaging = { name, version: published.version, peers };
      const files = contractPackageFilesOf({ snapshot: published, text }, packaging);
      return { kind: 'files', files, copied: [], build: 'with-tsc' };
    }
    case 'definitions':
      return await definitionsFilesOf(npm, project, { published, text, peers });
  }
}

/** A Definitions Package's files: its own as `npm pack` lists them, with its package.json and `snapshot.json` written over. */
async function definitionsFilesOf(
  npm: NpmPlace,
  { directory, manifest: source }: Pick<Project, 'directory' | 'manifest'>,
  { published, text, peers }: DefinitionsToStage,
): Promise<StagedFiles | Failed> {
  const manifest = definitionsManifestOf(source, published, { peers });
  if (manifest.kind === 'unpublishable') {
    return { kind: 'failed', message: manifest.line };
  }
  const packed = await packedPathsOf(npm);
  if (packed.kind === 'failed') {
    return packed;
  }
  const copied = packed.paths.map((path) => ({ from: join(directory, path), path }));
  const files = [manifest.file, { path: packagePaths.snapshot, text }];
  return { kind: 'files', files, copied, build: 'by-author' };
}
