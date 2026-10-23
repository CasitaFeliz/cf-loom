/** A setting the Service cannot start without, read from the environment and refused by name when it is not set. */
export function environmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
