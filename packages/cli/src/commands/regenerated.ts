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
 * The files a Service regenerates beside its Snapshot, and a line for every Command's Message
 * Version or Subscription the readers could not import as it is named, which leaves the readers
 * file out; or the line saying which name cannot be written as code.
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
  const mapFile = handlerMapFileOf(service);
  const { readers: readersFile } = service.project.layout;
  const messages = messageExportsOf(service, exportsOf);
  const readers = readersTextOf(service.snapshot, readersFile, messages);
  switch (readers.kind) {
    case 'unnamed':
      return readers;
    case 'refused':
      return { kind: 'files', files: [mapFile], failureLines: readers.lines };
    case 'text': {
      const readersFileText: GeneratedFile = {
        path: readersFile,
        text: readers.text,
        written: 'always',
      };
      return { kind: 'files', files: [mapFile, readersFileText], failureLines: [] };
    }
  }
}

function handlerMapFileOf(service: PlacedService): GeneratedFile {
  const { handlerMap } = service.project.layout;
  const stamps = deprecationStampsOf(service.snapshot);
  const text = handlerMapTextOf(mappedPathsOf(service), stamps, handlerMap);
  return { path: handlerMap, text, written: 'always' };
}
