/** The lines `init` ensures in `.gitattributes`, so Git keeps the generated files' line endings as `generate` writes them. */
const attributeLines = [
  'contract.snapshot.json text eol=lf',
  '*.generated.ts text eol=lf',
] as const;

/** The file `init` writes them to, next to package.json. */
export const gitAttributesFile = '.gitattributes';

/**
 * What `init` appends to a `.gitattributes` for it to hold both lines: the whole file when there
 * is none, else the lines it lacks after its last line; nothing when it holds both. A line of the
 * file is never edited or removed.
 */
export function attributesToAppendOf(existing: string | undefined): string | undefined {
  if (existing === undefined) {
    return attributeLines.map((line) => `${line}\n`).join('');
  }
  const held = existing.split('\n').map((line) => line.trim());
  const lacking = attributeLines.filter((line) => !held.includes(line));
  if (lacking.length === 0) {
    return undefined;
  }
  const lineBreak = existing === '' || existing.endsWith('\n') ? '' : '\n';
  return `${lineBreak}${lacking.map((line) => `${line}\n`).join('')}`;
}
