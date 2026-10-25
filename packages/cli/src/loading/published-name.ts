import type { PackageName } from './project-package.ts';
import type { RootKind } from './roots.ts';

/**
 * The npm name a project publishes as: `<scope>/contract-<name>`, or `contract-<name>` unscoped,
 * for a Service or an Application; its package.json's name for a Definitions Package.
 */
export function publishedNameOf({ scope, name }: PackageName, kind: RootKind): string {
  switch (kind) {
    case 'service':
    case 'application':
      return scope === undefined ? `contract-${name}` : `${scope}/contract-${name}`;
    case 'definitions':
      return scope === undefined ? name : `${scope}/${name}`;
  }
}
