import { childrenOf, type Defs, type SchemaNode, type Step } from '../walker/index.ts';
import { resolvedRefOf } from './ref-defs.ts';

/** A node only the former Input has, recorded for copying as it was, as it is read: a `ref` names its def source, any other node its children. */
export type CopyRecord = {
  readonly node: SchemaNode;
  readonly children: CopyChild[];
  ref: { readonly source: number; readonly nullable: boolean } | undefined;
};

/** A node inside a node being copied, at its step. */
export type CopyChild = { readonly step: Step; readonly record: CopyRecord };

/** A def only the former Input reaches, copied as it was. `base` is the name of the def it comes from. */
export type CopySource = {
  readonly kind: 'copy';
  readonly base: string;
  readonly body: CopyRecord;
};

/**
 * The defs a graft meets, in the order it meets them: the pairs of a former node and a proposed
 * def, which the graft records, and the defs only the former Input reaches, with where each sits
 * by its name there.
 */
export type DefSources<PairSource> = {
  readonly all: (PairSource | CopySource)[];
  readonly copied: Map<string, number>;
};

/**
 * A former node only the Former Input has, recorded for copying as it was, each def it reaches
 * recorded once by the name its alias defs lead to, depth first in the order the node holds its
 * children, with an explicit stack.
 */
export function copyRecordOf<PairSource>(
  node: SchemaNode,
  defs: Defs,
  sources: DefSources<PairSource>,
): CopyRecord {
  const root = unreadCopyOf(node);
  const pending = [root];
  for (let record = pending.pop(); record !== undefined; record = pending.pop()) {
    for (const next of readCopy(record, defs, sources).toReversed()) {
      pending.push(next);
    }
  }
  return root;
}

function unreadCopyOf(node: SchemaNode): CopyRecord {
  return { node, children: [], ref: undefined };
}

/** Reads a node's children, or the def a `ref` leads to, and gives the records to read next. */
function readCopy<PairSource>(
  record: CopyRecord,
  defs: Defs,
  sources: DefSources<PairSource>,
): readonly CopyRecord[] {
  const { node } = record;
  if (node.type !== 'ref') {
    for (const { steps, node: child } of childrenOf(node)) {
      const [step] = steps;
      if (step !== undefined) {
        record.children.push({ step, record: unreadCopyOf(child) });
      }
    }
    return record.children.map((child) => child.record);
  }
  const resolved = resolvedRefOf(node, defs);
  const known = sources.copied.get(resolved.name);
  const source = known ?? sources.all.length;
  record.ref = { source, nullable: resolved.nullable };
  if (known !== undefined) {
    return [];
  }
  const body = unreadCopyOf(resolved.def);
  sources.all.push({ kind: 'copy', base: resolved.name, body });
  sources.copied.set(resolved.name, source);
  return [body];
}
