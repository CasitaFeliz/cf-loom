/** What every declaration returns: what was written, its containers copied and frozen, a kind. */
export function frozenDeclaration<const Kind extends string, Fields extends object>(
  kind: Kind,
  fields: Fields,
): Readonly<Fields> & { readonly kind: Kind } {
  const declaration = { ...frozenFields(fields), kind };
  return Object.freeze(declaration) as Readonly<Fields> & { readonly kind: Kind };
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

/** Only plain objects without a `kind` are copied: a zod schema and a declaration keep identity. */
function isPlainContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || 'kind' in value) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
