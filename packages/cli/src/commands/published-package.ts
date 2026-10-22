import { join } from 'node:path';
import type { PublishedDefinitionsSnapshot, PublishedSnapshot } from '@cf-loom/contract/internal';
import { type Built, builtWithTsc } from '../building/index.ts';
import {
  contractPackageFilesOf,
  definitionsManifestOf,
  type PackageFile,
  type Peers,
  packagePaths,
} from '../contract-package/index.ts';
import { publishedNameOf } from '../loading/index.ts';
import type { Project, Run } from '../project/index.ts';
import {
  type DistTag,
  type Failed,
  type NpmPlace,
  type Publishing,
  packedPathsOf,
  publishFolder,
} from '../registry/index.ts';
import { type CopiedFile, removeStaged, stagedIn } from '../writing/index.ts';

/** What a publish puts out: the package's Snapshot as published with its text, the peers it is built with and its dist-tag. */
export type ToPublish = {
  readonly project: Project;
  readonly published: PublishedSnapshot;
  readonly text: string;
  readonly peers: Peers;
  readonly tag: DistTag;
};

/** The files a package is staged from: those written, and those of the project copied as they are. */
type StagedFiles = {
  readonly kind: 'files';
  readonly files: readonly PackageFile[];
  readonly copied: readonly CopiedFile[];
};

/**
 * Stages the package of a published Snapshot inside the project, builds a Contract Package there
 * with the project's own TypeScript, publishes it through the organization's npm and removes the
 * staging folder, whatever the outcome.
 */
export async function publishedPackageOf(
  run: Run,
  toPublish: ToPublish,
): Promise<{ readonly kind: 'published' } | Failed> {
  const { project, published, tag } = toPublish;
  const npm = { directory: project.directory, env: run.env };
  const files = await stagedFilesOf(npm, toPublish);
  if (files.kind === 'failed') {
    return files;
  }
  const staged = stagedIn(project.directory, files.files, files.copied);
  if (staged.kind === 'failed') {
    return staged;
  }
  try {
    const packageName = publishedNameOf(project.scope, published);
    const publishing = { folder: staged.folder, packageName, version: published.version, tag };
    const built = await builtIfContractPackage(publishing, project, published.kind);
    return built.kind === 'failed' ? built : await publishFolder(npm, publishing);
  } finally {
    removeStaged(staged.folder);
  }
}

async function stagedFilesOf(npm: NpmPlace, toPublish: ToPublish): Promise<StagedFiles | Failed> {
  const { project, published, text, peers } = toPublish;
  switch (published.kind) {
    case 'service':
    case 'application': {
      const packaging = { scope: project.scope, version: published.version, peers };
      const generated = contractPackageFilesOf({ snapshot: published, text }, packaging);
      if (generated.kind === 'unnamed') {
        return { kind: 'failed', message: generated.line };
      }
      return { kind: 'files', files: generated.files, copied: [] };
    }
    case 'definitions':
      return await definitionsFilesOf(npm, toPublish, published);
  }
}

/** A Definitions Package's files: its own as `npm pack` lists them, with its package.json and `snapshot.json` written over. */
async function definitionsFilesOf(
  npm: NpmPlace,
  { project, text, peers }: ToPublish,
  published: PublishedDefinitionsSnapshot,
): Promise<StagedFiles | Failed> {
  const packaging = { scope: project.scope, peers };
  const manifest = definitionsManifestOf(project.manifest, published, packaging);
  if (manifest.kind === 'unpublishable') {
    return { kind: 'failed', message: manifest.line };
  }
  const packed = await packedPathsOf(npm);
  if (packed.kind === 'failed') {
    return packed;
  }
  const copied = packed.paths.map((path) => ({ from: join(project.directory, path), path }));
  return { kind: 'files', files: [manifest.file, { path: packagePaths.snapshot, text }], copied };
}

/** A Contract Package is built with the project's TypeScript; a Definitions Package is built by its author. */
async function builtIfContractPackage(
  { folder, packageName, version }: Publishing,
  { directory, rootFile }: Project,
  kind: PublishedSnapshot['kind'],
): Promise<Built> {
  if (kind === 'definitions') {
    return { kind: 'built' };
  }
  const rootPath = join(directory, rootFile);
  return await builtWithTsc({ folder, rootPath, spec: `${packageName}@${version}` });
}
