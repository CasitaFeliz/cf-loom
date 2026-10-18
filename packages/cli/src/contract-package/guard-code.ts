import type { CodeSnapshot, GuardSnapshot, SchemaNode } from '@casitafeliz/loom-contract/internal';
import { noNeeds, type Writing, zodExpressionOf } from '../schema-code/index.ts';
import { stringLiteralOf } from '../source-text/index.ts';
import { partsLinesOf } from './endpoint-code.ts';
import { packageModuleOf, type SchemaFile, type Sibling } from './modules.ts';
import { guardFileOf, rejectionFileOf, rejectionNameOf } from './names.ts';

/**
 * A Guard as declared: what it demands, the Guards it reads, its Context, Qualifier schema and
 * Rejections, so the Endpoints attaching it resolve the same Input and Rejections.
 */
export function guardModuleOf(name: string, guard: GuardSnapshot): SchemaFile {
  const declared: Writing = { mode: 'declared', needs: noNeeds() };
  const rejections = guard.rejections.map((code) => rejectionNameOf(code));
  const body = [
    `export const ${name} = defineGuard({`,
    `  name: ${stringLiteralOf(name)},`,
    `  description: ${stringLiteralOf(guard.description)},`,
    ...(guard.guards.length === 0 ? [] : [`  guards: [${guard.guards.join(', ')}],`]),
    ...partsLinesOf('demands', guard.demands, declared),
    ...schemaLineOf('context', guard.context, declared),
    ...schemaLineOf('qualifier', guard.qualifier, declared),
    ...(rejections.length === 0 ? [] : [`  rejections: [${rejections.join(', ')}],`]),
    '});',
  ];
  const listed = guard.guards.map(
    (listedName): Sibling => ({
      name: listedName,
      path: guardFileOf(listedName),
    }),
  );
  const answered = guard.rejections.map(
    (code): Sibling => ({ name: rejectionNameOf(code), path: rejectionFileOf(code) }),
  );
  const file = packageModuleOf({
    path: guardFileOf(name),
    contractNames: ['defineGuard'],
    needs: declared.needs,
    writesSchemas: hasSchema(guard),
    siblings: [...listed, ...answered],
    body,
  });
  return { file, defs: declared.needs.defs };
}

/** A Rejection by its code, its body a reader, since Callers read it. */
export function rejectionModuleOf(code: string, declared: CodeSnapshot): SchemaFile {
  const reader: Writing = { mode: 'reader', needs: noNeeds() };
  const bodyNode = declared.body;
  const body = [
    `export const ${rejectionNameOf(code)} = defineRejection({`,
    `  code: ${stringLiteralOf(code)},`,
    `  status: ${declared.status},`,
    `  message: ${stringLiteralOf(declared.message)},`,
    ...schemaLineOf('body', bodyNode, reader),
    '});',
  ];
  const file = packageModuleOf({
    path: rejectionFileOf(code),
    contractNames: ['defineRejection'],
    needs: reader.needs,
    writesSchemas: bodyNode !== null,
    siblings: [],
    body,
  });
  return { file, defs: reader.needs.defs };
}

function schemaLineOf(key: string, node: SchemaNode | null, writing: Writing): readonly string[] {
  return node === null ? [] : [`  ${key}: ${zodExpressionOf(node, writing)},`];
}

function hasSchema(guard: GuardSnapshot): boolean {
  const { demands, context, qualifier } = guard;
  return [demands.headers, demands.query, context, qualifier].some((node) => node !== null);
}
