import { type Guard, isGuard, isRejection, type Rejection } from '../declarations/index.ts';
import { byCodePoint } from '../walker/index.ts';
import {
  type Declarations,
  type ExportsOf,
  isSchema,
  listOf,
  reachedGuardsOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** The name a Definitions Package's root file exports its Definitions object under. */
const definitionsExport = 'definitions';

/**
 * A Definitions Package's root file exports what it shares and nothing else: its Definitions
 * object once, Guards, Rejections and zod schemas, among them every Guard and Rejection an
 * exported Guard reaches, since Services import them to attach and to reject.
 */
export function exportFailures(
  { root }: Declarations,
  exportsOf: ExportsOf,
): readonly DeclarationFailure[] {
  if (root.kind !== 'definitions') {
    return [];
  }
  const exports = exportsOf(root);
  const names = Object.keys(exports).sort(byCodePoint);
  return [
    ...names.flatMap((name) => otherExportFailures(name, exports[name], root)),
    ...unexportedFailures(names, exports),
  ];
}

function otherExportFailures(
  name: string,
  value: unknown,
  root: unknown,
): readonly DeclarationFailure[] {
  const at = ['exports', name];
  if (name === '__proto__') {
    return [
      failure(
        at,
        'definitions-export',
        `${exportsOnly}: nothing named __proto__, which no Snapshot can hold`,
      ),
    ];
  }
  if (value === root) {
    return name === definitionsExport
      ? []
      : [
          failure(
            at,
            'definitions-export',
            `${exportsOnly}: its definitions once, as ${definitionsExport}, not as ${name}`,
          ),
        ];
  }
  if (isGuard(value) || isRejection(value) || isSchema(value)) {
    return [];
  }
  return [failure(at, 'definitions-export', `${exportsOnly}: ${name} is none of them`)];
}

/** Each Guard or Rejection an exported Guard reaches unexported, reported once, at the first export, in code point order, that reaches it. */
function unexportedFailures(
  names: readonly string[],
  exports: Readonly<Record<string, unknown>>,
): readonly DeclarationFailure[] {
  const exported = new Set(Object.values(exports));
  const reported = new Set<Guard | Rejection>();
  const failures: DeclarationFailure[] = [];
  for (const name of names) {
    const value = exports[name];
    const reached = isGuard(value) ? reachOf(value) : [];
    for (const declaration of reached.filter((member) => !exported.has(member))) {
      if (!reported.has(declaration)) {
        const label = isGuard(declaration) ? declaration.name : declaration.code;
        const message = `${exportsReach}: ${textOf(label)}`;
        failures.push(failure(['exports', name], 'definitions-unexported', message));
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
