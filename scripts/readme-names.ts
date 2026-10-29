const declarations =
  /^(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+(\w+)/gm;
const exportedDeclarations =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+(\w+)/gm;
const ownDeclarations =
  /^(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+(\w+)/gm;
const ownDestructurings = /^(?:const|let|var)\s+\{([^}]*)\}/gm;
const destructurings = /^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}/gm;
const imports = /^import\s+(?:type\s+)?([^;'"]*?)\s+from\s+['"][^'"]+['"]/gm;

/** The names a file declares at its top level, an import's among them. */
export function declaredNames(source: string): Set<string> {
  const names = [...source.matchAll(declarations)].map((match) => match[1] ?? '');
  for (const match of source.matchAll(destructurings)) {
    names.push(...(match[1] ?? '').split(',').map(boundName));
  }
  for (const match of source.matchAll(imports)) {
    names.push(...(match[1] ?? '').split(/[{},]/).map(importedName));
  }
  return new Set(names.filter((name) => name !== ''));
}

/** The names a file exports by declaring them, which another file may import. */
export function exportedNames(source: string): string[] {
  return [...source.matchAll(exportedDeclarations)].map((match) => match[1] ?? '');
}

/** The names a file declares at its top level for itself: no import, type or export. */
export function ownNames(source: string): string[] {
  const names = [...source.matchAll(ownDeclarations)].map((match) => match[1] ?? '');
  for (const match of source.matchAll(ownDestructurings)) {
    names.push(...(match[1] ?? '').split(',').map(boundName));
  }
  return names.filter((name) => name !== '');
}

/** Every word of a file that could name something. */
export function mentionedNames(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? []);
}

/** The name an entry of a destructuring binds: `a`, `a = 1`, `a: b` and `...a` bind `a`, `a`, `b` and `a`. */
function boundName(entry: string): string {
  const target = entry.split(':').at(-1) ?? '';
  return (
    target
      .replace(/^\s*\.\.\./, '')
      .split('=')[0]
      ?.trim() ?? ''
  );
}

/** The name a piece of an import clause binds: `a`, `type a`, `a as b` and `* as a` bind `a`, `a`, `b` and `a`. */
function importedName(piece: string): string {
  const name =
    piece
      .trim()
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)
      .at(-1) ?? '';
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : '';
}
