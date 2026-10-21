import type { DefinitionsSnapshot, PublishedDefinitionsSnapshot } from '../snapshot/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import type { Difference, SiteDifferences } from './report.ts';
import { schemaDifferencesOf } from './schemas.ts';

/**
 * A Definitions Package's shared schemas paired by name, in code point order: added, removed, or
 * compared in every Position, since no Element uses a shared schema yet.
 */
export function sharedSchemaDifferencesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly SiteDifferences[] {
  const defs = bothDefsOf(baseline, proposed);
  return counterpartsOf(baseline.schemas, proposed.schemas).map((schema) => ({
    site: { kind: 'shared-schema', name: schema.key },
    differences: differencesOf(schema, defs),
  }));
}

function differencesOf(schema: Counterpart<SchemaNode>, defs: BothDefs): readonly Difference[] {
  switch (schema.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return [{ kind: 'removed' }];
    case 'kept':
      return schemaDifferencesOf({ baseline: schema.baseline, proposed: schema.proposed }, defs, {
        position: 'every',
        at: [],
      });
  }
}
