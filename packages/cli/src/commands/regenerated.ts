import type { ExportsOf } from '../loading/index.ts';
import { type BuiltProject, snapshotFile } from '../project/index.ts';
import { deprecationStampsOf, handlerMapTextOf, readersTextOf } from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';
import { mappedPathsOf, type PlacedService } from './handler-files.ts';
import { messageExportsOf } from './message-exports.ts';

/** `contract.snapshot.json`, which every root regenerates. */
export function snapshotFileOf(built: BuiltProject): GeneratedFile {
  return { path: snapshotFile, text: built.bytes, written: 'always' };
}

/**
 * The files a Service regenerates beside its Snapshot, and a line for every Message the readers
 * could not import as it is named, which leave the readers file out; or the line saying which name
 * cannot be written as code.
 */
export type ServiceFiles =
  | {
      readonly kind: 'files';
      readonly files: readonly GeneratedFile[];
      readonly failureLines: readonly string[];
    }
  | { readonly kind: 'unnamed'; readonly line: string };

/** The files a Service regenerates beside its Snapshot: its Handler map and its readers. */
export function serviceFilesOf(service: PlacedService, exportsOf: ExportsOf): ServiceFiles {
  const { handlerMap, readers: readersFile } = service.project.layout;
  const mapped = mappedPathsOf(service);
  const stamps = deprecationStampsOf(service.snapshot);
  const mapFile: GeneratedFile = {
    path: handlerMap,
    text: handlerMapTextOf(mapped, stamps, handlerMap),
    written: 'always',
  };
  const messages = messageExportsOf(service, exportsOf);
  if (messages.kind === 'refused') {
    return { kind: 'files', files: [mapFile], failureLines: messages.lines };
  }
  const readers = readersTextOf(service.snapshot, readersFile, messages.atOf);
  if (readers.kind === 'unnamed') {
    return readers;
  }
  const readersFileText: GeneratedFile = {
    path: readersFile,
    text: readers.text,
    written: 'always',
  };
  return { kind: 'files', files: [mapFile, readersFileText], failureLines: [] };
}
