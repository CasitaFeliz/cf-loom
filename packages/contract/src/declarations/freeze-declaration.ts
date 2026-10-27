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

/** The fields of a declaration, each copied and frozen as `frozenCopyOf` does, sharing one copy per container. */
function frozenFields(fields: object): object {
  return frozenCopyFrom(fields);
}

/**
 * A value with its plain objects and lists copied and frozen all the way down, so what holds it can
 * never change it; any other value, a declaration or a schema, keeps its identity.
 */
export function frozenCopyOf(value: unknown): unknown {
  return isCopied(value) ? frozenCopyFrom(value) : value;
}

/** A container being copied: its copy and the members of the original still to copy into it. */
type Copying = {
  readonly copy: object;
  readonly members: readonly (readonly [string, unknown])[];
  next: number;
};

/**
 * A container's copy, each container it holds copied once, so one it holds twice or that holds
 * itself is so in the copy too, and frozen once its members are: read with an explicit stack.
 */
function frozenCopyFrom(root: object): object {
  const copies = new Map<object, object>();
  const frames: Copying[] = [];
  const rootCopy = opened(root, copies, frames);
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const member = frame.members[frame.next++];
    if (member === undefined) {
      frames.pop();
      Object.freeze(frame.copy);
      continue;
    }
    const [key, value] = member;
    const copy = isCopied(value) ? (copies.get(value) ?? opened(value, copies, frames)) : value;
    Object.defineProperty(frame.copy, key, {
      value: copy,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return rootCopy;
}

function opened(container: object, copies: Map<object, object>, frames: Copying[]): object {
  const copy = Array.isArray(container) ? new Array(container.length) : {};
  copies.set(container, copy);
  frames.push({ copy, members: Object.entries(container), next: 0 });
  return copy;
}

function isCopied(value: unknown): value is object {
  return Array.isArray(value) || isPlainContainer(value);
}

/** A declaration, from any copy of this package, and a zod schema keep their identity. */
function isPlainContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || declarationBrand in value) {
    return false;
  }
  return Object.getPrototypeOf(value) === Object.prototype;
}
