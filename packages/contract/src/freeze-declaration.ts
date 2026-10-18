const declarations = new WeakSet<object>();

/** What every declaration returns: what was written, its containers copied and frozen, a kind. */
export function freezeDeclaration<const Kind extends string, Fields extends object>(
  kind: Kind,
  fields: Fields,
): Readonly<Fields> & { readonly kind: Kind } {
  const declaration = Object.freeze({ ...frozenFields(fields), kind });
  declarations.add(declaration);
  return declaration as Readonly<Fields> & { readonly kind: Kind };
}

function frozenFields(fields: object): object {
  const entries = Object.entries(fields).map(([field, value]) => [field, frozenContainer(value)]);
  return Object.fromEntries(entries);
}

function frozenContainer(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozenContainer));
  }
  if (!isPlainContainer(value)) {
    return value;
  }
  return Object.freeze(frozenFields(value));
}

/** A declaration and a zod schema keep their identity; every other plain object is copied. */
function isPlainContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || declarations.has(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
