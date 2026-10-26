import { exportNamesOf } from '@cf-loom/contract/internal';
import { contractExportsOf } from '../loading/index.ts';
import type { FileOf } from './failures.ts';
import type { Project } from './project.ts';

/**
 * Where a failure's declaration is exported, as far as the project's files say. A Service's
 * Contract is every file under `src/contract/`, read for what each exports; an Application's or a
 * Definitions Package's is its Root file alone. A file that cannot be read leaves the failures
 * without files, never a tooling error in their place.
 */
export async function fileOfIn(project: Project): Promise<FileOf> {
  if (project.root.kind !== 'service') {
    return rootFileOf(project);
  }
  const exports = await contractExportsOf(project.directory);
  if (exports.kind === 'failed') {
    return () => undefined;
  }
  return (declaration) => exports.exportsOf(declaration)[0]?.path;
}

/** The Root file, for the Root and for what it exports beside it. */
function rootFileOf({ root, rootExports, rootFile }: Project): FileOf {
  return (declaration) => {
    if (declaration === undefined) {
      return undefined;
    }
    const isExported = declaration === root || exportNamesOf(rootExports, declaration).length > 0;
    return isExported ? rootFile : undefined;
  };
}
