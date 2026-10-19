import { type BuiltProject, type BuiltService, snapshotFile } from '../project/index.ts';
import {
  deprecationStampsOf,
  handledOf,
  handlerMapFile,
  handlerMapTextOf,
  readersFile,
  readersTextOf,
} from '../service-code/index.ts';
import type { GeneratedFile } from '../writing/index.ts';

/** `contract.snapshot.json`, which every root regenerates. */
export function snapshotFileOf(built: BuiltProject): GeneratedFile {
  return { path: snapshotFile, text: built.bytes, written: 'always' };
}

/** The files a Service regenerates beside its Snapshot: its Handler map and its readers. */
export function serviceFilesOf(service: BuiltService): readonly GeneratedFile[] {
  const handled = handledOf(service.snapshot);
  const stamps = deprecationStampsOf(service.snapshot);
  return [
    { path: handlerMapFile, text: handlerMapTextOf(handled, stamps), written: 'always' },
    { path: readersFile, text: readersTextOf(), written: 'always' },
  ];
}
