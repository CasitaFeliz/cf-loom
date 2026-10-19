import type { GuardSnapshot } from '@casitafeliz/loom-contract/internal';
import { loomNeeds, type Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import { bindingOf, type Declared, fileOf, siblingOf } from './names.ts';
import { partsLinesOf, schemaLineOf } from './schema-lines.ts';

/**
 * A Guard as declared: what it demands, the Guards it reads, its Context, Qualifier schema and
 * Rejections, so the Endpoints attaching it resolve the same Input and Rejections.
 */
export function guardModuleOf(declared: Declared, guard: GuardSnapshot): SchemaFile {
  const { name } = declared;
  const writing: Writing = { mode: 'declared', needs: loomNeeds() };
  const listed = guard.guards.map((name) => bindingOf({ kind: 'guard', name }));
  const rejections = guard.rejections.map((name) => bindingOf({ kind: 'rejection', name }));
  const body = [
    `export const ${bindingOf(declared)} = loom.defineGuard({`,
    `  name: ${stringLiteralOf(name)},`,
    `  description: ${stringLiteralOf(guard.description)},`,
    ...(listed.length === 0 ? [] : [`  guards: [${listed.join(', ')}],`]),
    ...partsLinesOf('demands', guard.demands, writing),
    ...schemaLineOf('context', guard.context, writing),
    ...schemaLineOf('qualifier', guard.qualifier, writing),
    ...(rejections.length === 0 ? [] : [`  rejections: [${rejections.join(', ')}],`]),
    '});',
  ];
  const { needs } = writing;
  const file = packageModuleOf({
    path: fileOf(declared),
    body,
    siblings: [
      ...guard.guards.map((name) => siblingOf({ kind: 'guard', name })),
      ...guard.rejections.map((name) => siblingOf({ kind: 'rejection', name })),
    ],
    needs,
  });
  return { file, defUses: [...needs.defs.values()] };
}
