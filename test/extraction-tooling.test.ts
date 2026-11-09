/** Extraction and contributor tooling must coexist without weakening either publication or observation contracts. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { object } from "./support.ts";

void test("all extraction contract tools are authored TypeScript without JavaScript fallbacks", () => {
  for (const name of readdirSync("test")) {
    assert.ok(!name.endsWith(".mjs"), name);
  }
  assert.ok(
    readdirSync("test/fixtures").includes("brace-copy-resource-child.ts"),
  );
  assert.ok(readdirSync("test/fixtures").includes("package-smoke.ts"));
  assert.doesNotMatch(
    readFileSync("test/package.test.ts", "utf8"),
    /smoke\.mjs/,
  );
  const scripts = object(
    object(JSON.parse(readFileSync("package.json", "utf8"))).scripts,
  );
  assert.equal(
    scripts["test:contracts"],
    "node --experimental-strip-types --test test/*.test.ts",
  );
  assert.equal(scripts["test:analysis"], "vitest run --maxWorkers=2");
  assert.equal(
    scripts.test,
    "pnpm test:contracts && pnpm test:analysis && pnpm test:types",
  );
});

void test("source and build retain extraction strictness and the full analysis API report", () => {
  const config = object(JSON.parse(readFileSync("tsconfig.json", "utf8")));
  const options = object(config.compilerOptions);
  assert.equal(options.exactOptionalPropertyTypes, true);
  assert.equal(options.noEmitOnError, true);
  assert.notEqual(options.skipLibCheck, true);
  const report = readFileSync("api-report/sh-analysis.api.md", "utf8");
  for (const name of [
    "enumerateCommands",
    "resolveWord",
    "resolveArgv0",
    "CommandInventory",
    "ShAnalyzeResourceError",
  ]) {
    assert.ok(report.includes(name), name);
  }
});
