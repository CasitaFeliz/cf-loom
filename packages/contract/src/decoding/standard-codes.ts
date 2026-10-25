import {
  isRejectionStatus,
  notImplementedStatus,
  standardRejectionNames,
} from '../declarations/index.ts';
import type { PublishedSnapshot } from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';

/**
 * The codes the Standard Rejections name whose body is not the Rejection's own, since only the
 * invalid-input Rejection has a body; a code the Snapshot does not hold is reported elsewhere.
 */
export function standardBodyProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const problems: Problem[] = [];
  for (const name of standardRejectionNames) {
    const code = snapshot.standardRejections[name];
    const held = Object.hasOwn(snapshot.codes, code) ? snapshot.codes[code] : undefined;
    const hasBody = held !== undefined && held.body !== null;
    const needsBody = name === 'invalidInput';
    if (held === undefined || hasBody === needsBody) {
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
 * The codes whose status no Rejection has: a 4xx, or 501 on the code the not-implemented Standard
 * Rejection names or on a removed code, which `publish` carries forward with the status it last had.
 */
export function codeStatusProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind === 'application') {
    return [];
  }
  const problems: Problem[] = [];
  for (const [code, { status, removed }] of Object.entries(snapshot.codes)) {
    const mayBeNotImplemented = removed || code === snapshot.standardRejections.notImplemented;
    const allowed =
      isRejectionStatus(status) || (mayBeNotImplemented && status === notImplementedStatus);
    if (!allowed) {
      problems.push({ at: ['codes', code, 'status'], reason: 'is no status a Rejection has' });
    }
  }
  return problems;
}
