import type { GuardSnapshot } from '@casitafeliz/loom-contract/internal';
import type { Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { loomNeeds, packageModuleOf, type SchemaFile } from './modules.ts';
import {
  guardBindingOf,
  guardFileOf,
  guardSiblingOf,
  rejectionBindingOf,
  rejectionSiblingOf,
} from './names.ts';
import { partsLinesOf, schemaLineOf } from './schema-lines.ts';

/**
 * A Guard as declared: what it demands, the Guards it reads, its Context, Qualifier schema and
 * Rejections, so the Endpoints attaching it resolve the same Input and Rejections.
 */
export function guardModuleOf(name: string, guard: GuardSnapshot): SchemaFile {
  const declared: Writing = { mode: 'declared', needs: loomNeeds() };
  const listed = guard.guards.map(guardBindingOf);
  const rejections = guard.rejections.map(rejectionBindingOf);
  const body = [
    `export const ${guardBindingOf(name)} = loom.defineGuard({`,
    `  name: ${stringLiteralOf(name)},`,
    `  description: ${stringLiteralOf(guard.description)},`,
    ...(listed.length === 0 ? [] : [`  guards: [${listed.join(', ')}],`]),
    ...partsLinesOf('demands', guard.demands, declared),
    ...schemaLineOf('context', guard.context, declared),
    ...schemaLineOf('qualifier', guard.qualifier, declared),
    ...(rejections.length === 0 ? [] : [`  rejections: [${rejections.join(', ')}],`]),
    '});',
  ];
  const { needs } = declared;
  const file = packageModuleOf({
    path: guardFileOf(name),
    body,
    siblings: [...guard.guards.map(guardSiblingOf), ...guard.rejections.map(rejectionSiblingOf)],
    needs,
  });
  return { file, defUses: [...needs.defs.values()] };
}
