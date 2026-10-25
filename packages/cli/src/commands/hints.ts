import type { Change, ChangeClass, ShapeDifference } from '@cf-loom/contract/internal';

/**
 * What to do about a Change the check does not accept, from a closed table of the moves that fix
 * one; the first row that fits decides, so a deleted Event takes its own hint and not the Message
 * Version one.
 */
export function hintOf(change: Change): string | null {
  const { difference } = change;
  if (difference.kind === 'deleted') {
    return 'retire it instead, deprecating it first if it is not, and delete it once the Baseline has it Retired';
  }
  if (difference.kind === 'retired-before-deprecated') {
    return 'deprecate it in one publish and retire it in a later one';
  }
  if (difference.kind === 'header-refuses-text') {
    return 'accept any text, or make the header required';
  }
  const shape = difference.kind === 'schema' ? shapeHintOf(difference.shape, change.class) : null;
  return shape ?? messageHintOf(change);
}

function shapeHintOf(shape: ShapeDifference, changeClass: ChangeClass): string | null {
  if (changeClass !== 'breaking') {
    return null;
  }
  if (shape.kind === 'value-added' && shape.enum === 'closed') {
    return 'declare it with openEnum, so readers take values added later';
  }
  if (shape.kind === 'field-added' && shape.required) {
    return 'make it optional';
  }
  return null;
}

function messageHintOf({ site, class: changeClass, verdict }: Change): string | null {
  const isMessage = site.kind === 'event' || site.kind === 'command';
  if (isMessage && changeClass === 'breaking' && verdict === 'refused') {
    return 'make the change in a new Message Version';
  }
  return null;
}
