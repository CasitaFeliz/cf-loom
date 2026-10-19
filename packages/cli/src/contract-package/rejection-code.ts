import type { CodeSnapshot } from '@casitafeliz/loom-contract/internal';
import { loomNeeds, type Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import { bindingOf, type Declared, fileOf } from './names.ts';
import { schemaLineOf } from './schema-lines.ts';

/** A Rejection by its code, its body a reader, since Callers read it. */
export function rejectionModuleOf(declared: Declared, code: CodeSnapshot): SchemaFile {
  const reader: Writing = { mode: 'reader', needs: loomNeeds() };
  const body = [
    `export const ${bindingOf(declared)} = loom.defineRejection({`,
    `  code: ${stringLiteralOf(declared.name)},`,
    `  status: ${code.status},`,
    `  message: ${stringLiteralOf(code.message)},`,
    ...schemaLineOf('body', code.body, reader),
    '});',
  ];
  const { needs } = reader;
  const file = packageModuleOf({ path: fileOf(declared), body, needs });
  return { file, defUses: [...needs.defs.values()] };
}
