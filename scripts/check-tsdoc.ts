import { globSync, readFileSync } from 'node:fs';

const exportedDeclaration =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|interface|type)\s+[A-Za-z_$]/;

/** The 1-based lines that export a declaration with no TSDoc directly above it (C20). */
export function undocumentedExports(source: string): number[] {
  const lines = source.split('\n');
  const undocumented: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (exportedDeclaration.test(line) && !hasDocAbove(lines, index)) {
      undocumented.push(index + 1);
    }
  }
  return undocumented;
}

/** Line comments, such as a lint directive, may sit between the TSDoc and the declaration. */
function hasDocAbove(lines: readonly string[], index: number): boolean {
  for (let above = index - 1; above >= 0; above -= 1) {
    const line = lines[above]?.trim() ?? '';
    if (!line.startsWith('//')) {
      return line.endsWith('*/') && opensDoc(lines, above);
    }
  }
  return false;
}

function opensDoc(lines: readonly string[], end: number): boolean {
  for (let above = end; above >= 0; above -= 1) {
    const line = lines[above] ?? '';
    if (line.includes('/*')) {
      return line.includes('/**');
    }
  }
  return false;
}

/** Every package's source, tests excluded, since what a file exports is read from another file. */
function checkPackages(): void {
  const sources = globSync('packages/*/src/**/*.ts').filter((path) => !path.endsWith('.test.ts'));
  for (const path of sources) {
    for (const line of undocumentedExports(readFileSync(path, 'utf8'))) {
      console.error(`${path}:${line} C20: an exported declaration carries TSDoc.`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  checkPackages();
}
