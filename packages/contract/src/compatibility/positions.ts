import type { Position, ShapeDifference } from './report.ts';

/** How COMPATIBILITY.md classes a shape difference. */
export type ShapeClass = 'breaking' | 'additive' | 'neutral';

const strengthsInOrder = ['neutral', 'additive', 'breaking'] as const;
const positions: readonly Position[] = ['input', 'success', 'message'];

/**
 * The class COMPATIBILITY.md gives a shape difference in a Position; in `every`, the strongest of
 * the three, since a shared schema has no Position until an Element uses it.
 */
export function shapeClassOf(shape: ShapeDifference, position: Position | 'every'): ShapeClass {
  const [input, success] = inputAndSuccessClassesOf(shape);
  switch (position) {
    case 'input':
      return input;
    case 'success':
      return success;
    case 'message':
      return strongestOf([input, success]);
    case 'every':
      return strongestOf(positions.map((each) => shapeClassOf(shape, each)));
  }
}

function strongestOf(classes: readonly ShapeClass[]): ShapeClass {
  return strengthsInOrder.findLast((strength) => classes.includes(strength)) ?? 'neutral';
}

/**
 * The Fields and the Enums, literals and unions tables of COMPATIBILITY.md, whose Message column
 * is always the stronger of the other two.
 */
function inputAndSuccessClassesOf(shape: ShapeDifference): readonly [ShapeClass, ShapeClass] {
  switch (shape.kind) {
    case 'field-added':
      return shape.required ? ['breaking', 'additive'] : ['additive', 'additive'];
    case 'value-added':
      return shape.enum === 'open' ? ['additive', 'additive'] : ['additive', 'breaking'];
    case 'field-removed':
    case 'field-made-optional':
    case 'nullability-added':
    case 'enum-widened':
    case 'variant-added':
      return ['additive', 'breaking'];
    case 'field-made-required':
    case 'nullability-removed':
    case 'value-removed':
    case 'enum-narrowed':
    case 'variant-removed':
      return ['breaking', 'additive'];
    case 'enum-opened':
      return ['neutral', 'breaking'];
    case 'enum-closed':
      return ['neutral', 'additive'];
    case 'key-removed':
    case 'discriminator-changed':
    case 'union-changed':
    case 'mode-changed':
    case 'type-changed':
    case 'unproven':
      return ['breaking', 'breaking'];
  }
}
