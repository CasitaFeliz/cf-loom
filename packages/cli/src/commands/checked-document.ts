import type { Checked } from './checked.ts';
import { reasonOf } from './checked.ts';
import type { Document } from './exit.ts';

/**
 * The document `check` and `publish` print under `--json`: the package, what it was compared with,
 * every Change, the peer ranges that moved and the version `publish` would take, if it derives one.
 */
export function checkedDocumentOf(checked: Checked): Document {
  const { packageName, against, changes, derivation } = checked;
  const derived = derivation?.derived;
  const published = derived?.kind === 'version' ? derived : null;
  return {
    package: packageName,
    baseline: against.kind === 'baseline' ? against.version : null,
    stable: against.kind === 'baseline' ? (against.stable ?? null) : null,
    reason: against.kind === 'none' ? reasonOf(against.why) : null,
    changes,
    peers: derivation?.peers ?? [],
    bump: derivation?.bump ?? null,
    version: published?.version ?? null,
    tag: published?.tag ?? null,
  };
}
