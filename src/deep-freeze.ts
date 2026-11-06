/**
 * Recursively freezes `value` and every object/array it (transitively)
 * contains, so a frozen shared table's immutability holds at every level —
 * not just its own top-level keys — rather than relying on every caller to
 * treat it as read-only by convention.
 *
 * Own property values remain unknown until the object guard establishes that
 * recursive freezing applies; the helper does not infer a table schema.
 *
 * @internal
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    for (const key of Object.getOwnPropertyNames(value)) {
      const prop: unknown = Reflect.get(value, key);
      if (prop !== null && typeof prop === "object") {
        deepFreeze(prop);
      }
    }
    Object.freeze(value);
  }
  return value;
}
