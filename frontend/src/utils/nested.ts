export function setNestedValue<T>(obj: T, path: string, value: string): T {
  const result = structuredClone(obj);
  const keys = path.split(".");
  let current: any = result;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined) return result;
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}
