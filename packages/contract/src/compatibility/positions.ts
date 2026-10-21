import type { ChangeClass, PositionOrEvery, ShapeDifference } from './report.ts';

/** How COMPATIBILITY.md classes a shape difference. */
export type ShapeClass = Exclude<ChangeClass, 'not-allowed'>;

const strengthsInOrder = ['neutral', 'additive', 'breaking'] as const;

/**
 * The class COMPATIBILITY.md gives a shape difference in a Position. A Message takes the stronger
 * of the Input and Success classes, which is also the strongest of the three, so a shared schema,
 * judged in `every` Position, takes the same.
 */
export function shapeClassOf(shape: ShapeDifference, position: PositionOrEvery): ShapeClass {
  const [input, success] = inputAndSuccessClassesOf(shape);
  switch (position) {
    case 'input':
      return input;
    case 'success':
      return success;
    case 'message':
    case 'every':
      return strongestOf([input, success]);
  }
}

function strongestOf(classes: readonly ShapeClass[]): ShapeClass {
  return strengthsInOrder.findLast((strength) => classes.includes(strength)) ?? 'neutral';
}

/**
 * The Fields, Enums, literals and unions and Constraints tables of COMPATIBILITY.md, whose Message
 * column is always the stronger of the other two.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the classes of each kind of shape difference
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
    case 'constraint-relaxed':
      return ['additive', 'breaking'];
    case 'field-made-required':
    case 'nullability-removed':
    case 'value-removed':
    case 'enum-narrowed':
    case 'variant-removed':
    case 'constraint-tightened':
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
    case 'constraint-replaced':
    case 'rest-added':
    case 'rest-removed':
    case 'unproven':
      return ['breaking', 'breaking'];
  }
}
