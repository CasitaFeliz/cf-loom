import { standardRejectionNames } from '../declarations/index.ts';
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
