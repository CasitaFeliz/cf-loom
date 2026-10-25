import type { Step } from '@cf-loom/contract/internal';

/** What a name or a text may be on a Change line without quotes. */
const plainToken = /^[\w@/$-]+$/;

/** A text as it stands on a Change line: itself when plain, else as JSON, so it reads as one token. */
export function tokenOf(text: string): string {
  return plainToken.test(text) ? text : JSON.stringify(text);
}

/**
 * Steps in the author's terms: `success.body.orders[].lines[].kind<type="a">.x`, where `[]` is an
 * array's items, `[...]` a tuple's rest, `{}` a record's value, `{key}` its key and
 * `<discriminator=value>` a variant; none when there are no steps.
 */
export function authorPathOf(steps: readonly Step[]): string | null {
  if (steps.length === 0) {
    return null;
  }
  return steps.map((step, index) => textOf(step, index === 0)).join('');
}

function textOf(step: Step, isFirst: boolean): string {
  switch (step.kind) {
    case 'part':
      return named(step.name, isFirst);
    case 'field':
      return named(tokenOf(step.name), isFirst);
    case 'items':
      return '[]';
    case 'rest':
      return '[...]';
    case 'key':
      return '{key}';
    case 'value':
      return '{}';
    case 'variant':
      return `<${tokenOf(step.discriminator)}=${step.value}>`;
  }
}

function named(name: string, isFirst: boolean): string {
  return isFirst ? name : `.${name}`;
}
