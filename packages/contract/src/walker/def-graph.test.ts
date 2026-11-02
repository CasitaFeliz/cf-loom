import { describe, expect, test } from 'vitest';
import { type Defs, defGraphOf, type SchemaNode } from '../internal/index.ts';

const aString: SchemaNode = { type: 'string' };

describe('./internal, defGraphOf', () => {
  test.each(['constructor', 'toString', '__proto__'])(
    'a def is found under a name the defs hold as their own, never under one every object inherits: %s',
    (name) => {
      const held: Defs = Object.fromEntries([[name, aString]]);
      const inherited: Defs = {};

      const found = defGraphOf(held).def(name);
      const missing = defGraphOf(inherited).def(name);

      expect(found).toBe(aString);
      expect(missing).toBeUndefined();
    },
  );
});
