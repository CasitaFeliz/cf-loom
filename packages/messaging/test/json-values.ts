/** A limits file as JSON text holds it, so a key such as `__proto__` is an own key of the value. */
function fromJson(text: string): unknown {
  return JSON.parse(text);
}

const longerThanBreakLength = 'z'.repeat(200);

/** Values of every kind JSON holds, in the shapes on which a printed value could break a line. */
export const jsonValues: readonly unknown[] = [
  '',
  'a\nb',
  longerThanBreakLength,
  'a\n'.repeat(60),
  0,
  1.5,
  -1e21,
  true,
  false,
  null,
  [],
  [1, 2, 3, 4, 5, 6, 7],
  ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s'],
  [[[[1]]]],
  [{ a: [{ b: 1 }] }, 'a\nb'],
  {},
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 },
  { a: { b: { c: { d: 1 } } } },
  { 'a\nb': longerThanBreakLength },
  fromJson('{"__proto__":[1,2,3,4,5,6,7],"constructor":{"a":1},"toString":7,"hasOwnProperty":[]}'),
];

/** The kind of a JSON value: the six JSON has. */
export function jsonKindOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'list' : typeof value;
}
