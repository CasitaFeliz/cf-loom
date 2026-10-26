import type { Checked } from './checked.ts';
import { reasonOf } from './checked.ts';
import type { Document } from './exit.ts';

/**
 * The document `check` and `publish` print under `--json`: the package, what it was compared with,
 * every Change, the peer ranges that moved and the version `publish` would take, if it derives one.
 */
export function checkedDocumentOf(checked: Checked): Document {
  const { packageName, against, changes, derivation } = checked;
  const derived = derivation.kind === 'derived' ? derivation : undefined;
  const published = derived?.derived.kind === 'version' ? derived.derived : null;
  return {
    package: packageName,
    baseline: against.kind === 'baseline' ? against.version : null,
    stable: against.kind === 'baseline' ? (against.stable ?? null) : null,
    reason: against.kind === 'none' ? reasonOf(against.why) : null,
    changes,
    peers: derived?.peers ?? [],
    bump: derived?.bump ?? null,
    version: published?.version ?? null,
    tag: published?.tag ?? null,
  };
}
