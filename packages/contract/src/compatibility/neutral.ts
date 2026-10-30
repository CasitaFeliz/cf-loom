import type {
  CodeSnapshot,
  CommandSnapshot,
  EndpointSnapshot,
  EventSnapshot,
  GuardSnapshot,
  MessageTombstone,
} from '../snapshot/index.ts';
import { canonicalJson, type Defs, reachedDefsOf, type SchemaNode } from '../walker/index.ts';
import { reachesOnlyUnchanged } from './def-comparison.ts';
import type { BothDefs } from './findings.ts';
import { type Compared, comparedShapesOf, type Pair, retiredShapesOf } from './pairs.ts';
import type { Difference } from './report.ts';

/** What an Element or a Subscription says of itself besides its shapes: its description and Group. */
type Described = { readonly description: string; readonly group: string };

/** What an Element Retired in the proposed Snapshot may still declare. */
type Declaration = EndpointSnapshot | EventSnapshot | CommandSnapshot;

/** Whether two values differ in their canonical JSON, so the order of keys is no difference. */
function differ(left: unknown, right: unknown): boolean {
  return canonicalJson(left) !== canonicalJson(right);
}

/** The Neutral differences of a Subscription or an Element kept by identity: description, then Group. */
export function describedDifferencesOf(
  baseline: Described,
  proposed: Described,
): readonly Difference[] {
  const differences: Difference[] = [];
  if (baseline.description !== proposed.description) {
    differences.push({ kind: 'description-changed' });
  }
  if (baseline.group !== proposed.group) {
    differences.push({ kind: 'group-changed', from: baseline.group, to: proposed.group });
  }
  return differences;
}

/**
 * An Endpoint's Neutral differences: of one Retired now, whether it declares otherwise; else its
 * description, Group, Attachments, which no shape rule compares, then a moved `deprecatedAt`.
 */
export function endpointNeutralOf(
  pair: Pair<EndpointSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return retiredDifferencesOf(pair, defs);
  }
  const { baseline, proposed } = compared;
  const attachments: readonly Difference[] = differ(baseline.guards, proposed.guards)
    ? [{ kind: 'attachments-changed' }]
    : [];
  return [
    ...describedDifferencesOf(baseline, proposed),
    ...attachments,
    ...deprecationMovedOf(baseline, proposed),
  ];
}

/** A Deprecated Endpoint on both sides whose `deprecatedAt` moved. */
function deprecationMovedOf(
  baseline: EndpointSnapshot,
  proposed: EndpointSnapshot,
): readonly Difference[] {
  const { deprecatedAt: from } = baseline;
  const { deprecatedAt: to } = proposed;
  return from === undefined || to === undefined || from === to
    ? []
    : [{ kind: 'deprecation-moved', from, to }];
}

/**
 * A Message Version's Neutral differences: of one Retired now, whether it declares otherwise; else
 * its description, then Group.
 */
export function messageNeutralOf(
  pair: Pair<EventSnapshot | CommandSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return retiredDifferencesOf(pair, defs);
  }
  return describedDifferencesOf(compared.baseline, compared.proposed);
}

/**
 * A kept Guard's Neutral differences: description, the Guards it builds on, its Qualifier, its
 * Context, then its origin; a schema counts with the defs it reaches.
 */
export function guardNeutralOf(
  baseline: GuardSnapshot,
  proposed: GuardSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const differences: Difference[] = [];
  if (baseline.description !== proposed.description) {
    differences.push({ kind: 'description-changed' });
  }
  if (differ(baseline.guards, proposed.guards)) {
    differences.push({ kind: 'guards-changed' });
  }
  if (!isSameNode(baseline.qualifier, proposed.qualifier, defs)) {
    differences.push({ kind: 'qualifier-changed' });
  }
  if (!isSameNode(baseline.context, proposed.context, defs)) {
    differences.push({ kind: 'context-changed' });
  }
  return [...differences, ...originDifferencesOf(baseline, proposed)];
}

/**
 * What a Service's Guard itself demands and answers, whose effect the Endpoints that attach it
 * report: told when it differs, since an Endpoint that declares the same field or Rejection hides
 * it. Each is Neutral.
 */
export function guardSourcesOf(
  baseline: GuardSnapshot,
  proposed: GuardSnapshot,
  defs: BothDefs,
): readonly Difference[] {
  const differences: Difference[] = [];
  if (demandsKeyOf(baseline, defs.baseline) !== demandsKeyOf(proposed, defs.proposed)) {
    differences.push({ kind: 'demands-changed' });
  }
  if (differ(baseline.rejections, proposed.rejections)) {
    differences.push({ kind: 'rejections-changed' });
  }
  return differences;
}

/** A Guard's demands as text with the defs they reach, so a change in a def shows in them. */
function demandsKeyOf({ demands }: GuardSnapshot, defs: Defs): string {
  return canonicalJson([demands, reachedKeyOf([demands.headers, demands.query], defs)]);
}

/** A kept code's Neutral differences: its message, then its origin. */
export function codeNeutralOf(
  baseline: CodeSnapshot,
  proposed: CodeSnapshot,
): readonly Difference[] {
  const message: readonly Difference[] =
    baseline.message === proposed.message ? [] : [{ kind: 'message-changed' }];
  return [...message, ...originDifferencesOf(baseline, proposed)];
}

function originDifferencesOf(
  baseline: { readonly origin: string },
  proposed: { readonly origin: string },
): readonly Difference[] {
  if (baseline.origin === proposed.origin) {
    return [];
  }
  return [{ kind: 'origin-changed', from: baseline.origin, to: proposed.origin }];
}

/**
 * Whether an Element Retired in the proposed Snapshot declares anything the Baseline's declaration
 * did not, the defs it reaches included; nothing reads it, so no other rule compares it.
 */
function retiredDifferencesOf(pair: Pair<Declaration>, defs: BothDefs): readonly Difference[] {
  const compared = retiredShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const before = declarationKeyOf(compared.baseline, defs.baseline);
  const after = declarationKeyOf(compared.proposed, defs.proposed);
  return before === after ? [] : [{ kind: 'retired-changed' }];
}

/**
 * Whether two values are the same canonical text and every def their schema nodes reach is the
 * same on both sides; the nodes are the Baseline's, whose `ref`s the proposed one writes alike.
 */
function isSameReaching(
  { baseline, proposed }: Compared<unknown>,
  nodes: readonly SchemaNode[],
  defs: BothDefs,
): boolean {
  return !differ(baseline, proposed) && reachesOnlyUnchanged(nodes, defs);
}

/** Whether two schemas, or none, are the same text and reach the same defs. */
function isSameNode(
  baseline: SchemaNode | null,
  proposed: SchemaNode | null,
  defs: BothDefs,
): boolean {
  return isSameReaching({ baseline, proposed }, baseline === null ? [] : [baseline], defs);
}

/** What moves with an Element's lifecycle, which the lifecycle's own Change already reports. */
const historyKeys = ['lifecycle', 'retiredIn', 'deprecatedAt'] as const satisfies readonly (
  | keyof EndpointSnapshot
  | keyof MessageTombstone
)[];

/** A declaration as text with the defs it reaches, without the history the Baseline keeps of it. */
function declarationKeyOf(declaration: Declaration, defs: Defs): string {
  const declared = Object.entries(declaration).filter(
    ([key]) => !historyKeys.some((history) => history === key),
  );
  return canonicalJson([Object.fromEntries(declared), reachedKeyOf(nodesOf(declaration), defs)]);
}

function reachedKeyOf(
  nodes: readonly SchemaNode[],
  defs: Defs,
): readonly (readonly [string, unknown])[] {
  return reachedDefsOf(nodes, defs).map((name) => [name, defs[name]]);
}

function nodesOf(declaration: Declaration): readonly SchemaNode[] {
  if (!('input' in declaration)) {
    return [declaration.body];
  }
  const { input, success } = declaration;
  const nodes = [
    input.params,
    input.query,
    input.headers,
    input.body,
    success.headers,
    success.body,
  ];
  return nodes.filter(isNode);
}

function isNode(node: SchemaNode | null): node is SchemaNode {
  return node !== null;
}
