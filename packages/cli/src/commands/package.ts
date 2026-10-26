import { canonicalTextOf } from '@cf-loom/contract/internal';
import { contractPackageFilesOf } from '../contract-package/index.ts';
import { publishedNameOf } from '../loading/index.ts';
import { builtOf, type Run, runningGeneratorOf } from '../project/index.ts';
import { writeContractPackageTo } from '../writing/index.ts';
import { committedStopOf, done, type Exit, failureExitOf, toolingError } from './exit.ts';
import { builtPeersOf, publishedRangesOf } from './peers.ts';

/** Where `package` writes when no `--out` is given, next to package.json, in the folder that holds only cf-loom's output. */
export const defaultPackageFolder = '.cf-loom/contract-package';

/** The version a Contract Package `package` writes carries, and a document `openapi` or `asyncapi` prints, until `publish` derives one. */
export const localVersion = '0.0.0';

/**
 * Writes the Contract Package of a Service or an Application to `out`, generated from the
 * committed Snapshot, which must be what `generate` would write, so the package is a function of
 * the reviewed file and the CLI that runs; its `snapshot.json` names that CLI. A Definitions
 * Package is its own source and has none.
 */
export async function packageCommand(run: Run, out: string): Promise<Exit> {
  const built = await builtOf(run);
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  const { snapshot, project } = built;
  if (snapshot.kind === 'definitions') {
    return toolingError(
      'A Definitions Package has no Contract Package: it is published from its own source',
    );
  }
  const stop = committedStopOf(built);
  if (stop !== undefined) {
    return stop;
  }
  const peers = builtPeersOf(built);
  if (peers.kind === 'failed') {
    return toolingError(peers.message);
  }
  const name = publishedNameOf(project.packageName, snapshot.kind);
  const peerRanges = publishedRangesOf(built, peers.peers);
  const packaging = { name, version: localVersion, peerRanges };
  const packaged = { ...snapshot, generator: runningGeneratorOf() };
  const files = contractPackageFilesOf(
    { snapshot: packaged, text: canonicalTextOf(packaged) },
    packaging,
  );
  const written = writeContractPackageTo(run.cwd, out, files);
  switch (written.kind) {
    case 'written':
      return done([`Wrote ${out}`], { wrote: out });
    case 'refused':
    case 'failed':
      return toolingError(written.message);
  }
}
