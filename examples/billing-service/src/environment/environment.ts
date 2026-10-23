/** A setting the Service cannot start without, read from the environment and refused by name when it is not set or is empty. */
export function environmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set or empty`);
  return value;
}
