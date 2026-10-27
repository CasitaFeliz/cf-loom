/** Whether a value is a JSON scalar other than `null`: a string, a finite number or a boolean. */
export function isJsonPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);
}

/** Whether a value is a number JSON can write: `NaN` and `Infinity` have no JSON text. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value is JSON: scalars, `null`, and lists and plain objects of JSON, with no cycle,
 * read with an explicit stack that holds the containers on the path, so one held twice is JSON.
 */
export function isJsonValue(value: unknown): boolean {
  const onPath = new Set<object>();
  const frames: MembersRead[] = [];
  let member = value;
  for (;;) {
    if (!isJsonScalar(member)) {
      if (!isJsonContainer(member) || onPath.has(member)) {
        return false;
      }
      onPath.add(member);
      frames.push({ container: member, members: Object.values(member), next: 0 });
    }
    let frame = frames.at(-1);
    while (frame !== undefined && frame.next === frame.members.length) {
      frames.pop();
      onPath.delete(frame.container);
      frame = frames.at(-1);
    }
    if (frame === undefined) {
      return true;
    }
    member = frame.members[frame.next++];
  }
}

/** A list or plain object whose members are being read, and how many have been. */
type MembersRead = {
  readonly container: object;
  readonly members: readonly unknown[];
  next: number;
};

function isJsonScalar(value: unknown): boolean {
  return value === null || isJsonPrimitive(value);
}

function isJsonContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype;
}

/** A value as JSON with object keys sorted by code point, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
  return composedText(value, compactContainerOf);
}

/** Orders values by their canonical JSON, for the arrays whose order means nothing. */
export function byCanonicalJson(left: unknown, right: unknown): number {
  return byCodePoint(canonicalJson(left), canonicalJson(right));
}

/**
 * The values of an array whose order means nothing as a Snapshot holds them: each once, by its
 * canonical JSON, in that order, which the decoder requires back.
 */
export function inCanonicalJsonOrder<Value>(values: readonly Value[]): Value[] {
  const valueByJson = new Map(values.map((value) => [canonicalJson(value), value]));
  return [...valueByJson.values()].sort(byCanonicalJson);
}

/**
 * A value as a file holds it: canonical JSON indented by two spaces, one member or item per line,
 * so a change to one value is a change to one line of a review's diff. The keys of `first` that
 * the outermost object holds are written before the rest, in that order.
 */
export function indentedCanonicalJson(value: unknown, first: readonly string[] = []): string {
  return composedText(value, (container, depth) =>
    indentedContainerOf(container, depth, depth === 0 ? first : []),
  );
}

/** Orders text by code point, as the Snapshot orders keys and the arrays whose order means nothing. */
export function byCodePoint(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; ) {
    const leftPoint = left.codePointAt(index) ?? 0;
    const rightPoint = right.codePointAt(index) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
    index += leftPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

/** A list or object, the children its text is made of, and how their texts make it. */
type Composed = {
  readonly children: readonly unknown[];
  readonly textOf: (texts: readonly (string | undefined)[]) => string;
};

/** A container being composed, how deep it sits and the texts of the children made so far. */
type Composing = {
  readonly composed: Composed;
  readonly depth: number;
  readonly texts: (string | undefined)[];
};

/**
 * A value's text, a scalar's as `JSON.stringify` writes it and a container's from its children's
 * texts once they are made, read with an explicit stack.
 */
function composedText(
  value: unknown,
  containerOf: (value: unknown, depth: number) => Composed | undefined,
): string {
  const root = containerOf(value, 0);
  if (root === undefined) {
    return JSON.stringify(value);
  }
  const frames: Composing[] = [{ composed: root, depth: 0, texts: [] }];
  let made = '';
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const { children, textOf } = frame.composed;
    if (frame.texts.length === children.length) {
      frames.pop();
      made = textOf(frame.texts);
      frames.at(-1)?.texts.push(made);
      continue;
    }
    const child = children[frame.texts.length];
    const depth = frame.depth + 1;
    const composed = containerOf(child, depth);
    if (composed === undefined) {
      frame.texts.push(JSON.stringify(child));
    } else {
      frames.push({ composed, depth, texts: [] });
    }
  }
  return made;
}

function compactContainerOf(value: unknown): Composed | undefined {
  if (Array.isArray(value)) {
    return { children: value, textOf: (texts) => `[${texts.join(',')}]` };
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const members = membersOf(value, []);
  const textOf = (texts: readonly (string | undefined)[]) => {
    const written = members.map(([key], index) => `${JSON.stringify(key)}:${texts[index]}`);
    return `{${written.join(',')}}`;
  };
  return { children: members.map(([, member]) => member), textOf };
}

/**
 * An object's members that have a value, the keys of `first` leading in the order given and the
 * rest by key in code point order, whatever order JS keeps.
 */
function membersOf(
  value: object,
  first: readonly string[],
): readonly (readonly [string, unknown])[] {
  const present = Object.entries(value).filter(hasValue);
  const leading: (readonly [string, unknown])[] = [];
  for (const key of first) {
    const member = present.find(([name]) => name === key);
    if (member !== undefined) {
      leading.push(member);
    }
  }
  const rest = present.filter(([key]) => !first.includes(key));
  return [...leading, ...rest.sort(([left], [right]) => byCodePoint(left, right))];
}

function hasValue(entry: [string, unknown]): boolean {
  return entry[1] !== undefined;
}

function indentedContainerOf(
  value: unknown,
  depth: number,
  first: readonly string[],
): Composed | undefined {
  const indent = '  '.repeat(depth);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const textOf = (texts: readonly (string | undefined)[]) => {
      const items = texts.map((text) => `${inner}${text}`);
      return items.length === 0 ? '[]' : `[\n${items.join(',\n')}\n${indent}]`;
    };
    return { children: value, textOf };
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const members = membersOf(value, first);
  const textOf = (texts: readonly (string | undefined)[]) => {
    const written = members.map(
      ([key], index) => `${inner}${JSON.stringify(key)}: ${texts[index]}`,
    );
    return written.length === 0 ? '{}' : `{\n${written.join(',\n')}\n${indent}}`;
  };
  return { children: members.map(([, member]) => member), textOf };
}
