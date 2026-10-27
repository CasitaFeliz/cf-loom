/** The kebab-case of a camelCase name, which never loses information: `getOrder` is `get-order`. */
export function kebabCaseOf(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
