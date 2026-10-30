import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const sqsBroker = fileURLToPath(new URL('../sqs-broker/', import.meta.url));
const readme = fileURLToPath(new URL('../../README.md', import.meta.url));

/** The text of a source file, which the commands it imports are read from. */
function sourceOf(path: string): string {
  return readFileSync(path, 'utf8');
}

const importedNames = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(@aws-sdk\/client-(?:sns|sqs))'/g;
const relativeImports = /from\s+'(\.[^']+)'/g;

/** The IAM actions of the commands a file imports from the AWS clients, such as `sns:Publish` for `PublishCommand`. */
function commandsImportedBy(text: string): string[] {
  const actions: string[] = [];
  for (const [, names = '', client = ''] of text.matchAll(importedNames)) {
    const service = client.endsWith('sns') ? 'sns' : 'sqs';
    for (const name of names.split(',').map((entry) => entry.trim())) {
      if (name.endsWith('Command') && !name.startsWith('type ')) {
        actions.push(`${service}:${name.slice(0, -'Command'.length)}`);
      }
    }
  }
  return actions;
}

/** Every IAM action the files reached from `entry` through relative imports send, sorted. */
function actionsReachedFrom(entry: string): string[] {
  const reached = new Set<string>();
  const actions = new Set<string>();
  const pending = [entry];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (reached.has(path)) {
      continue;
    }
    reached.add(path);
    const text = sourceOf(path);
    for (const action of commandsImportedBy(text)) {
      actions.add(action);
    }
    for (const [, specifier = ''] of text.matchAll(relativeImports)) {
      pending.push(join(dirname(path), specifier));
    }
  }
  return [...actions].sort();
}

/** The IAM actions the rows of the README's `#### AWS permissions` table give to whoever the third column names, sorted. */
function actionsDocumentedFor(neededBy: string): string[] {
  const text = sourceOf(readme);
  const section = text.slice(text.indexOf('#### AWS permissions'));
  const table = section.slice(0, section.indexOf('\n## ', 1));
  const actions = new Set<string>();
  for (const row of table.split('\n').filter((line) => line.startsWith('| '))) {
    const [, iam = '', needed = ''] = row.split(' | ');
    if (needed.replace(/\s*\|$/, '').trim() === neededBy) {
      for (const [action = ''] of iam.matchAll(/(?:sns|sqs):\w+/g)) {
        actions.add(action);
      }
    }
  }
  return [...actions].sort();
}

describe('the AWS permissions the README documents', () => {
  test('the Service’s rows are exactly the commands sqs() sends, and the applier’s row exactly those applyBrokerPlan sends', () => {
    const service = actionsReachedFrom(join(sqsBroker, 'sqs.ts'));
    const applier = actionsReachedFrom(join(sqsBroker, 'applying.ts'));

    expect(actionsDocumentedFor('The Service')).toEqual(service);
    expect(actionsDocumentedFor('Whoever applies the Broker plan')).toEqual(applier);
    expect(service).toHaveLength(9);
    expect(applier).toHaveLength(12);
  });
});
