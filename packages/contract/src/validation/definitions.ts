import { type Guard, isRejection, type Rejection, type Root } from '../declarations/index.ts';
import { placeOf } from '../walker/index.ts';
import {
  type Declarations,
  listOf,
  type Members,
  reachedGuardsOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/**
 * A Definitions Package's Root file exports what it shares and nothing else beside its Root:
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
    ...others.map((name) => otherExportFailure(name, rootExports[name], root)),
    ...ownMembers.filter(({ name }) => name === '__proto__').map(protoFailure),
    ...unexportedFailures(ownMembers),
  ];
}

/** A value a Root file exports, under the name it exports it as. */
type ExportedAs = { readonly name: string; readonly value: unknown };

function otherExportFailure(name: string, value: unknown, root: Root): DeclarationFailure {
  const at = placeOf({ kind: 'export', name }, value);
  if (name === '__proto__') {
    return protoFailure({ name, value });
  }
  if (value === root) {
    return failure(
      at,
      'definitions-export',
      `${exportsOnly}: its definitions once, not as ${name}`,
    );
  }
  return failure(at, 'definitions-export', `${exportsOnly}: ${name} is none of them`);
}

function protoFailure({ name, value }: ExportedAs): DeclarationFailure {
  const message = `${exportsOnly}: nothing named __proto__, which no Snapshot can hold`;
  return failure(placeOf({ kind: 'export', name }, value), 'definitions-export', message);
}

/** Each Guard or Rejection an exported Guard reaches unexported, reported once, at the first export, in code point order, that reaches it. */
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
        failures.push(
          failure(
            placeOf({ kind: 'export', name: member.name }, member.value),
            'definitions-unexported',
            message,
          ),
        );
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
  "A Definitions Package's Root file exports only its definitions, Guards, Rejections and zod schemas";
const exportsReach =
  'A Definitions Package exports every Guard and Rejection its Guards reach, since Services import them to attach and to reject';
