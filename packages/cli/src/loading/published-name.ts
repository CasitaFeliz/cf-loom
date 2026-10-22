import type { Snapshot } from '@cf-loom/contract/internal';

/**
 * The npm name a project publishes as: `<scope>/contract-<name>` for a Service or an Application,
 * `<scope>/<name>` for a Definitions Package.
 */
export function publishedNameOf(
  scope: string,
  { kind, name }: Pick<Snapshot, 'kind' | 'name'>,
): string {
  switch (kind) {
    case 'service':
    case 'application':
      return `${scope}/contract-${name}`;
    case 'definitions':
      return `${scope}/${name}`;
    default:
      throw new Error(`no package is published for a Snapshot of kind ${String(kind)}`);
  }
}
