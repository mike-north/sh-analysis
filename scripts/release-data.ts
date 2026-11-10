/** Release inputs are untrusted data; validate containers before inspecting policy fields. */

/** Narrow objects without granting JSON or YAML values an unchecked structural type. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Malformed manifests and release plans must fail before authorization can succeed. */
export function releaseRecord(
  value: unknown,
  source: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${source}: expected an object. Release input is invalid.`);
  }
  return value;
}
