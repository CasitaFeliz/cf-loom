/** What every declaration returns: what was written, its plain containers copied and frozen, with its kind. */
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

/** A zod schema and a declaration, which carries a `kind`, keep their identity; anything else plain is copied. */
function isPlainContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || 'kind' in value) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
