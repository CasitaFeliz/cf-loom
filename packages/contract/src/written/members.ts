import type * as core from 'zod/v4/core';
import { type Guard, isGuard, isRejection, type Rejection } from '../declarations/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { isSchema } from './parts.ts';

/** One export of a Definitions Package's root file that it shares: a Guard, a Rejection or a zod schema, under its export name. */
export type Member =
  | { readonly name: string; readonly kind: 'guard'; readonly value: Guard }
  | { readonly name: string; readonly kind: 'rejection'; readonly value: Rejection }
  | { readonly name: string; readonly kind: 'schema'; readonly value: core.$ZodType };

/** A Definitions Package's members, one per export, in code point order of their names. */
export type Members = readonly Member[];

/**
 * What a Definitions Package holds: each export that is a Guard, a Rejection or a zod schema, by
 * export name; the Definitions object and anything else are left out.
 */
export function membersOf(exports: Readonly<Record<string, unknown>>): Members {
  const members: Member[] = [];
  for (const name of Object.keys(exports).sort(byCodePoint)) {
    const member = memberOf(name, exports[name]);
    if (member !== undefined) {
      members.push(member);
    }
  }
  return members;
}

function memberOf(name: string, value: unknown): Member | undefined {
  if (isGuard(value)) {
    return { name, kind: 'guard', value };
  }
  if (isRejection(value)) {
    return { name, kind: 'rejection', value };
  }
  return isSchema(value) ? { name, kind: 'schema', value } : undefined;
}

/** The Guards among a package's members, each once. */
export function memberGuardsOf(members: Members): readonly Guard[] {
  const guards = members.map((member) => (member.kind === 'guard' ? member.value : undefined));
  return [...new Set(guards.filter(isGuard))];
}

/** The Rejections among a package's members, each once. */
export function memberRejectionsOf(members: Members): readonly Rejection[] {
  const rejections = members.map((member) =>
    member.kind === 'rejection' ? member.value : undefined,
  );
  return [...new Set(rejections.filter(isRejection))];
}
