/** What a declaration at the top of a file is: a value or a type. */
type Kind = 'value' | 'type';

/** Whether a declaration is exported by name, by `export default`, or not at all. */
type Exporting = 'named' | 'default' | 'none';

type Declaration = { readonly name: string; readonly kind: Kind; readonly exporting: Exporting };

const declaration =
  /^(export\s+)?(?:declare\s+)?(default\s+)?(?:async\s+)?(const|let|var|function\*?|class|type|interface|enum)\s+(\w+)/gm;
const destructuring = /^(export\s+)?(?:const|let|var)\s+\{([^}]*)\}/gm;

/** The names a file exports by declaring them, which another file may import. */
export function exportedNames(source: string): string[] {
  const exported = declarationsOf(source).filter(({ exporting }) => exporting === 'named');
  return exported.map(({ name }) => name);
}

/** The names a file declares at its top level for itself: no import, type or export. */
export function ownNames(source: string): string[] {
  const own = declarationsOf(source).filter(
    ({ kind, exporting }) => kind === 'value' && exporting === 'none',
  );
  return own.map(({ name }) => name);
}

function declarationsOf(source: string): Declaration[] {
  const found: Declaration[] = [];
  for (const [, exported, defaulted, keyword, name] of source.matchAll(declaration)) {
    const kind =
      keyword === 'type' || keyword === 'interface' || keyword === 'enum' ? 'type' : 'value';
    found.push({ name: name ?? '', kind, exporting: exportingOf(exported, defaulted) });
  }
  for (const [, exported, bindings] of source.matchAll(destructuring)) {
    for (const binding of (bindings ?? '').split(',')) {
      found.push({
        name: boundName(binding),
        kind: 'value',
        exporting: exportingOf(exported, undefined),
      });
    }
  }
  return found.filter(({ name }) => name !== '');
}

function exportingOf(exported: string | undefined, defaulted: string | undefined): Exporting {
  if (exported === undefined) {
    return 'none';
  }
  return defaulted === undefined ? 'named' : 'default';
}

/** The name a binding of a destructuring binds: `a`, `a = 1`, `a: b` and `...a` bind `a`, `a`, `b` and `a`. */
function boundName(binding: string): string {
  const target = binding.split(':').at(-1) ?? '';
  return (
    target
      .replace(/^\s*\.\.\./, '')
      .split('=')[0]
      ?.trim() ?? ''
  );
}
