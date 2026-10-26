import { loomNeeds, type Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { deprecatedLinesOf, elementLinesOf } from './element-lines.ts';
import type { ExportedEvent } from './exported-snapshot.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import { fileOf, providedOpeningOf } from './names.ts';
import { schemaLineOf } from './schema-lines.ts';

/**
 * An exported Event's Message Version rebuilt from its Snapshot entry with `providedEvent`, its
 * body a Reader schema, since its Subscribers read it, and marked as `provider`'s.
 */
export function eventModuleOf(
  { name, version, event }: ExportedEvent,
  provider: string,
): SchemaFile {
  const declared = { kind: 'event', name, version } as const;
  const reader: Writing = { mode: 'reader', needs: loomNeeds() };
  const body = [
    ...deprecatedLinesOf(event),
    providedOpeningOf(declared, provider),
    `  name: ${stringLiteralOf(name)},`,
    `  version: ${version},`,
    ...elementLinesOf(event),
    ...schemaLineOf('body', event.body, reader),
    '});',
  ];
  const { needs } = reader;
  const file = packageModuleOf({ path: fileOf(declared), body, needs });
  return { file, defUses: [...needs.defs.values()] };
}
