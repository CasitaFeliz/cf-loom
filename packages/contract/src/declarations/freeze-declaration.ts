const declarationBrand = Symbol.for('@cf-loom/contract.declaration');

/**
 * What every declaration returns: what was written, its containers copied and frozen, a kind. A
 * mark is set before the freeze, which takes no property after it.
 */
export function freezeDeclaration<const Kind extends string, Fields extends object>(
  kind: Kind,
  fields: Fields,
  marks: Readonly<Record<symbol, unknown>> = {},
): Readonly<Fields> & { readonly kind: Kind } {
  const declaration = { ...frozenFields(fields), kind };
  Object.defineProperty(declaration, declarationBrand, { value: true });
  for (const mark of Object.getOwnPropertySymbols(marks)) {
    Object.defineProperty(declaration, mark, { value: marks[mark] });
  }
  return Object.freeze(declaration) as Readonly<Fields> & { readonly kind: Kind };
}

/** Whether a value came out of a `define*` of this package, from any copy of it: it carries the brand. */
export function isDeclaration(value: unknown): value is { readonly kind: unknown } {
  return typeof value === 'object' && value !== null && declarationBrand in value;
}

function frozenFields(fields: object): object {
  const entries = Object.entries(fields).map(([field, value]) => [field, frozenCopyOf(value)]);
  return Object.fromEntries(entries);
}

/**
 * A value with its plain objects and lists copied and frozen all the way down, so what holds it can
 * never change it; any other value, a declaration or a schema, keeps its identity.
 */
export function frozenCopyOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozenCopyOf));
  }
  if (!isPlainContainer(value)) {
    return value;
  }
  return Object.freeze(frozenFields(value));
}

/** A declaration, from any copy of this package, and a zod schema keep their identity. */
function isPlainContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || declarationBrand in value) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
