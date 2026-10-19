import type { CodeSnapshot } from '@casitafeliz/loom-contract/internal';
import type { Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { loomNeeds, packageModuleOf, type SchemaFile } from './modules.ts';
import { rejectionBindingOf, rejectionFileOf } from './names.ts';
import { schemaLineOf } from './schema-lines.ts';

/** A Rejection by its code, its body a reader, since Callers read it. */
export function rejectionModuleOf(code: string, declared: CodeSnapshot): SchemaFile {
  const reader: Writing = { mode: 'reader', needs: loomNeeds() };
  const body = [
    `export const ${rejectionBindingOf(code)} = loom.defineRejection({`,
    `  code: ${stringLiteralOf(code)},`,
    `  status: ${declared.status},`,
    `  message: ${stringLiteralOf(declared.message)},`,
    ...schemaLineOf('body', declared.body, reader),
    '});',
  ];
  const { needs } = reader;
  const file = packageModuleOf({ path: rejectionFileOf(code), body, needs });
  return { file, defUses: [...needs.defs.values()] };
}
