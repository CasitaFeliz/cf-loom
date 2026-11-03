import { heldNodeOf, type NodeEdit, type SchemaNode, withoutNullable } from '../walker/index.ts';
import type { CopyRecord } from './graft-copy.ts';
import type { GraftRecord, PairRecord, RecordEdit } from './graft-record.ts';

/** The query, body and defs named apart that a Former Input's graft writes. */
export type BuiltGraft = {
  readonly query: SchemaNode;
  /** None when the Former Input or the Endpoint has no body to graft. */
  readonly body: SchemaNode | undefined;
  readonly out: Map<string, SchemaNode>;
};

type Names = readonly (string | undefined)[];

/**
 * The query, body and defs named apart that the record writes, each node built once, the nodes it
 * holds first, with an explicit stack.
 */
export function builtGraftOf(record: GraftRecord, names: Names): BuiltGraft {
  const built = new Map<PairRecord, SchemaNode>();
  const query = builtNodeOf(record.query, { names, built });
  const body = record.body === undefined ? undefined : builtNodeOf(record.body, { names, built });
  const out = new Map<string, SchemaNode>();
  for (const [index, source] of record.sources.all.entries()) {
    const name = names[index];
    if (name !== undefined) {
      const node =
        source.kind === 'pair'
          ? builtNodeOf(source.end, { names, built })
          : copiedNodeOf(source.body, names);
      out.set(name, withoutNullable(node));
    }
  }
  return { query, body, out };
}

type Building = { readonly names: Names; readonly built: Map<PairRecord, SchemaNode> };

/** A `ref` renamed to the def the graft writes it to, nullable when a `ref` on the way to that def is. */
function renamedRef(
  ref: SchemaNode,
  destination: { readonly name: string; readonly nullable: boolean },
): SchemaNode {
  return heldNodeOf(ref, [{ kind: 'renamed', ...destination }]);
}

function heldFor<Key>(built: ReadonlyMap<Key, SchemaNode>, key: Key): SchemaNode {
  const node = built.get(key);
  if (node === undefined) {
    throw new Error('A node used before it was built: a bug.');
  }
  return node;
}

function builtNodeOf(root: PairRecord, building: Building): SchemaNode {
  const pending = [root];
  for (let record = pending.at(-1); record !== undefined; record = pending.at(-1)) {
    const unbuilt = neededBy(record).filter((held) => !building.built.has(held));
    if (building.built.has(record) || unbuilt.length === 0) {
      pending.pop();
      if (!building.built.has(record)) {
        building.built.set(record, nodeOf(record, building));
      }
    }
    for (const held of unbuilt) {
      pending.push(held);
    }
  }
  return heldFor(building.built, root);
}

function isChildEdit(edit: RecordEdit): edit is Extract<RecordEdit, { kind: 'child' }> {
  return edit.kind === 'child';
}

/** The records whose nodes a pair's node is built from: the pairs inside it, or, for a pair written in place against a `ref`, the pair its chain ends at. */
function neededBy({ met, edits, end }: PairRecord): readonly PairRecord[] {
  if (met.hop === undefined) {
    return edits.filter(isChildEdit).map((edit) => edit.record);
  }
  return met.pair.proposed.type !== 'ref' && end !== undefined ? [end] : [];
}

/** A pair's node once the nodes it is built from are built. */
function nodeOf(record: PairRecord, building: Building): SchemaNode {
  const { pair, hop } = record.met;
  if (hop === undefined) {
    return heldNodeOf(pair.proposed, editsOf(record, building));
  }
  if (record.end === undefined) {
    return pair.proposed;
  }
  if (pair.proposed.type !== 'ref') {
    return heldFor(building.built, record.end);
  }
  const name = record.end.source === undefined ? undefined : building.names[record.end.source];
  const nullable = hop.resolved.proposed?.nullable === true;
  return name === undefined ? pair.proposed : renamedRef(pair.proposed, { name, nullable });
}

function editsOf(record: PairRecord, { names, built }: Building): readonly NodeEdit[] {
  return record.edits.map((edit): NodeEdit => {
    if (edit.kind === 'child') {
      return { kind: 'child', step: edit.step, node: heldFor(built, edit.record) };
    }
    const schema = copiedNodeOf(edit.copy, names);
    return { kind: 'field', name: edit.name, field: { ...edit.field, schema } };
  });
}

/** A node copied as it was, each `ref` in it written to the def the graft copies it to, children before the nodes that hold them. */
function copiedNodeOf(root: CopyRecord, names: Names): SchemaNode {
  const order: CopyRecord[] = [];
  const pending = [root];
  for (let record = pending.pop(); record !== undefined; record = pending.pop()) {
    order.push(record);
    for (const child of record.children) {
      pending.push(child.record);
    }
  }
  const copied = new Map<CopyRecord, SchemaNode>();
  for (const record of order.toReversed()) {
    copied.set(record, copyOf(record, { names, copied }));
  }
  return heldFor(copied, root);
}

function copyOf(
  record: CopyRecord,
  {
    names,
    copied,
  }: { readonly names: Names; readonly copied: ReadonlyMap<CopyRecord, SchemaNode> },
): SchemaNode {
  const name = record.ref === undefined ? undefined : names[record.ref.source];
  if (record.ref !== undefined) {
    if (name === undefined) {
      throw new Error('A def copied without a name: a bug.');
    }
    return renamedRef(record.node, { name, nullable: record.ref.nullable });
  }
  const edits = record.children.map(({ step, record: child }): NodeEdit => {
    return { kind: 'child', step, node: heldFor(copied, child) };
  });
  return heldNodeOf(record.node, edits);
}
