import { type Guard, isRejection, type Rejection } from '../declarations/index.ts';
import {
  type Declarations,
  listOf,
  type Members,
  reachedGuardsOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/**
 * A Definitions Package's root file exports what it shares and nothing else beside its root:
 * Guards, Rejections and zod schemas, among them every Guard and Rejection an exported Guard
 * reaches, since Services import them to attach and to reject.
 */
export function exportFailures(
  { root, ownMembers }: Declarations,
  rootExports: Readonly<Record<string, unknown>>,
): readonly DeclarationFailure[] {
  if (ownMembers === undefined) {
    return [];
  }
  const memberNames = new Set(ownMembers.map(({ name }) => name));
  const others = Object.keys(rootExports).filter((name) => !memberNames.has(name));
  return [
    ...others.map((name) => otherExportFailure(name, rootExports[name] === root)),
    ...ownMembers.filter(({ name }) => name === '__proto__').map(protoFailure),
    ...unexportedFailures(ownMembers),
  ];
}

function otherExportFailure(name: string, isRoot: boolean): DeclarationFailure {
  const at = ['exports', name];
  if (name === '__proto__') {
    return protoFailure({ name });
  }
  if (isRoot) {
    return failure(
      at,
      'definitions-export',
      `${exportsOnly}: its definitions once, not as ${name}`,
    );
  }
  return failure(at, 'definitions-export', `${exportsOnly}: ${name} is none of them`);
}

function protoFailure({ name }: { readonly name: string }): DeclarationFailure {
  const message = `${exportsOnly}: nothing named __proto__, which no Snapshot can hold`;
  return failure(['exports', name], 'definitions-export', message);
}

/** Each Guard or Rejection an exported Guard reaches unexported, reported once, at the first export that reaches it. */
function unexportedFailures(members: Members): readonly DeclarationFailure[] {
  const exported = new Set<unknown>(members.map(({ value }) => value));
  const reported = new Set<Guard | Rejection>();
  const failures: DeclarationFailure[] = [];
  for (const member of members) {
    const reached = member.kind === 'guard' ? reachOf(member.value) : [];
    for (const declaration of reached.filter((value) => !exported.has(value))) {
      if (!reported.has(declaration)) {
        const label = 'code' in declaration ? declaration.code : declaration.name;
        const message = `${exportsReach}: ${textOf(label)}`;
        failures.push(failure(['exports', member.name], 'definitions-unexported', message));
      }
      reported.add(declaration);
    }
  }
  return failures;
}

/** The Guards a Guard reaches through the Guards each lists, itself left out, and the Rejections all of them answer. */
function reachOf(guard: Guard): readonly (Guard | Rejection)[] {
  const guards = reachedGuardsOf([guard]);
  const rejections = guards.flatMap((reached) => listOf(reached.rejections)).filter(isRejection);
  return [...guards.filter((reached) => reached !== guard), ...new Set(rejections)];
}

const exportsOnly =
  "A Definitions Package's root file exports only its definitions, Guards, Rejections and zod schemas";
const exportsReach =
  'A Definitions Package exports every Guard and Rejection its Guards reach, since Services import them to attach and to reject';
