import type { CodeSnapshot } from '@cf-loom/contract/internal';
import { loomNeeds, type Writing } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { packageModuleOf, type SchemaFile } from './modules.ts';
import { bindingOf, fileOf, type PackagedDeclaration } from './names.ts';
import { declaredTextPartOf, schemaLineOf } from './schema-lines.ts';

/** A Rejection by its code, its headers and body readers, since Callers read them. */
export function rejectionModuleOf(
  declared: Extract<PackagedDeclaration, { readonly kind: 'rejection' }>,
  code: CodeSnapshot,
): SchemaFile {
  const reader: Writing = { mode: 'reader', needs: loomNeeds() };
  const body = [
    `export const ${bindingOf(declared)} = loom.providedRejection({`,
    `  code: ${stringLiteralOf(declared.code)},`,
    `  status: ${code.status},`,
    `  message: ${stringLiteralOf(code.message)},`,
    ...schemaLineOf('headers', declaredTextPartOf(code.headers), reader),
    ...schemaLineOf('body', code.body, reader),
    '});',
  ];
  const { needs } = reader;
  const file = packageModuleOf({ path: fileOf(declared), body, needs });
  return { file, defUses: [...needs.defs.values()] };
}
