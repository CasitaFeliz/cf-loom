import {
  isRejectionStatus,
  notImplementedStatus,
  type StandardRejectionName,
  standardRejectionNames,
} from '../declarations/index.ts';
import {
  isEmptyTextPart,
  isRemoved,
  type PublishedCode,
  type PublishedSnapshot,
} from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';

/** A code a Standard Rejection names that the Snapshot holds, with the Standard Rejection's name. */
type HeldStandard = {
  readonly name: StandardRejectionName;
  readonly code: string;
  readonly held: PublishedCode;
};

/**
 * The codes the Standard Rejections name whose body is not the Rejection's own, since only the
 * invalid-input Rejection has a body; a code the Snapshot does not hold is reported elsewhere.
 */
export function standardBodyProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  const problems: Problem[] = [];
  for (const { name, code, held } of heldStandardsOf(snapshot)) {
    const hasBody = held.body !== null;
    const needsBody = name === 'invalidInput';
    if (hasBody === needsBody) {
      continue;
    }
    const reason = needsBody
      ? `holds no body, which the ${name} Standard Rejection always has`
      : `holds a body, which the ${name} Standard Rejection never has`;
    problems.push({ at: ['codes', code, 'body'], reason });
  }
  return problems;
}

/**
 * The codes the Standard Rejections name that hold headers, since none of them declares any; a code
 * the Snapshot does not hold is reported elsewhere.
 */
export function standardHeaderProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  return heldStandardsOf(snapshot)
    .filter(({ held }) => !isEmptyTextPart(held.headers))
    .map(({ name, code }) => ({
      at: ['codes', code, 'headers'],
      reason: `holds headers, which the ${name} Standard Rejection never has`,
    }));
}

function heldStandardsOf(snapshot: PublishedSnapshot): readonly HeldStandard[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const held: HeldStandard[] = [];
  for (const name of standardRejectionNames) {
    const code = snapshot.standardRejections[name];
    const declared = Object.hasOwn(snapshot.codes, code) ? snapshot.codes[code] : undefined;
    if (declared !== undefined) {
      held.push({ name, code, held: declared });
    }
  }
  return held;
}

/**
 * The codes whose status no Rejection has: a 4xx, or 501 on the code the not-implemented Standard
 * Rejection names or on a removed code, which `publish` carries forward with the status it last had.
 */
export function codeStatusProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const problems: Problem[] = [];
  for (const [code, declared] of Object.entries(snapshot.codes)) {
    const { status } = declared;
    const mayBeNotImplemented =
      isRemoved(declared) || code === snapshot.standardRejections.notImplemented;
    const allowed =
      isRejectionStatus(status) || (mayBeNotImplemented && status === notImplementedStatus);
    if (!allowed) {
      problems.push({ at: ['codes', code, 'status'], reason: 'is no status a Rejection has' });
    }
  }
  return problems;
}
