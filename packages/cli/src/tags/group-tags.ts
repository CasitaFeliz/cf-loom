import { byCodePoint, type ServiceSnapshot } from '@cf-loom/contract/internal';

/** A Group as a tag of an OpenAPI or an AsyncAPI document: its name and what it is for. */
export type GroupTag = { readonly name: string; readonly description: string };

/** The Groups that list one of the written Elements, whose Groups are `listing`, in code point order. */
export function groupTagsOf(
  groups: ServiceSnapshot['groups'],
  listing: readonly string[],
): readonly GroupTag[] {
  const listed = new Set(listing);
  const tags = Object.entries(groups)
    .filter(([name]) => listed.has(name))
    .map(([name, { description }]) => ({ name, description }));
  return tags.sort((left, right) => byCodePoint(left.name, right.name));
}
