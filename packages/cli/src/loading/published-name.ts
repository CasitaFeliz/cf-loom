import type { RootKind } from '@cf-loom/contract/internal';
import { type PackageName, packageJsonNameOf } from './project-package.ts';

/**
 * The npm name a project publishes as: `<scope>/contract-<name>`, or `contract-<name>` unscoped,
 * for a Service or an Application; its package.json's name for a Definitions Package.
 */
export function publishedNameOf(packageName: PackageName, kind: RootKind): string {
  switch (kind) {
    case 'service':
    case 'application':
      return packageJsonNameOf({ ...packageName, name: `contract-${packageName.name}` });
    case 'definitions':
      return packageJsonNameOf(packageName);
  }
}
