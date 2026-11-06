/** Independent package ownership is enforced from source imports and actual built exports. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

void test("analysis consumes only public syntax APIs and owns its errors", async () => {
  for (const filename of readdirSync("src").filter((name) =>
    name.endsWith(".ts"),
  )) {
    const source = readFileSync(`src/${filename}`, "utf8");
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(
        specifier === "sh-ast" || specifier.startsWith("./"),
        `${filename}: ${specifier}`,
      );
    }
    assert.doesNotMatch(
      source,
      /callSyntax|decodeWire|encodeWire|wasm-instance|generated\//,
      filename,
    );
  }
  const analysis = await import("../dist/index.js");
  const binding = await import("sh-ast");
  assert.equal(Reflect.get(analysis, "parseSync"), undefined);
  assert.equal(Reflect.get(analysis, "ShAstError"), undefined);
  assert.ok(
    new analysis.ShAnalyzeMaxDepthError(500) instanceof
      analysis.ShAnalysisError,
  );
  assert.ok(
    !(new analysis.ShAnalyzeMaxDepthError(500) instanceof binding.ShAstError),
  );
});
