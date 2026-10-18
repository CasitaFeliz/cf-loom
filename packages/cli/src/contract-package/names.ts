import { camelCaseOf, kebabCaseOf, kebabCaseOfCode } from '../source-text/index.ts';

/** The file of an exported Endpoint in the package. */
export function endpointFileOf(name: string): string {
  return `src/endpoints/${kebabCaseOf(name)}.ts`;
}

/** The file of a Guard the package's Endpoints attach. */
export function guardFileOf(name: string): string {
  return `src/guards/${kebabCaseOf(name)}.ts`;
}

/** The file of a Rejection the package's Endpoints or Guards answer, by its code. */
export function rejectionFileOf(code: string): string {
  return `src/rejections/${kebabCaseOfCode(code)}.ts`;
}

/** The name a Rejection is exported under, from its code: `ORDER_LOCKED` is `orderLocked`. */
export function rejectionNameOf(code: string): string {
  return camelCaseOf(kebabCaseOfCode(code));
}
