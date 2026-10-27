import type {
  DefinitionsSnapshot,
  ExportSnapshot,
  PublishedDefinitionsSnapshot,
} from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { schemaDifferencesOf } from './schemas.ts';

/**
 * A Definitions Package's exports paired by name, in code point order: added, removed, now naming
 * something else, or, for a kept schema, compared as a Message, the strongest Position, since no
 * Element uses a shared schema yet.
 */
export function exportDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  return counterpartsOf(baseline.exports, proposed.exports).map((exported) => ({
    site: { kind: 'export', name: exported.key, visibility: 'public' },
    differences: differencesOf(exported, defs),
  }));
}

function differencesOf(
  exported: Counterpart<ExportSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  switch (exported.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return [{ kind: 'removed' }];
    case 'kept':
      return keptDifferencesOf(exported.baseline, exported.proposed, defs);
  }
}

function keptDifferencesOf(
  baseline: ExportSnapshot,
  proposed: ExportSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  if (baseline.kind === 'schema' && proposed.kind === 'schema') {
    const nodes = { baseline: baseline.schema, proposed: proposed.schema };
    return schemaDifferencesOf(nodes, defs, { position: 'message', at: [] });
  }
  const from = exportedAs(baseline);
  const to = exportedAs(proposed);
  return from === to ? [] : [{ kind: 'export-changed', from, to }];
}

/** What an export names, in words: `guard apiKey`, `rejection FORBIDDEN` or `schema`. */
function exportedAs(exported: ExportSnapshot): string {
  switch (exported.kind) {
    case 'guard':
      return `guard ${exported.guard}`;
    case 'rejection':
      return `rejection ${exported.code}`;
    case 'schema':
      return 'schema';
  }
}
