import type { SchemaNode } from '@casitafeliz/loom-contract/internal';

/** A Snapshot node of one type. */
export type NodeOf<Type extends SchemaNode['type']> = Extract<SchemaNode, { readonly type: Type }>;
