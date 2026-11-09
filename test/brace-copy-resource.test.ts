/** Deep input must refuse at a known typed boundary on a normal stack, independently of host clone capacity. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { object, objects } from "./support.ts";

void test("a valid deep Word has a known typed refusal without mutation or poisoning reuse", () => {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(
        new URL("./fixtures/brace-copy-resource-child.ts", import.meta.url),
      ),
    ],
    {
      env: environment,
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const observed = object(JSON.parse(result.stdout));
  const attempts = objects(observed.attempts);
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    if (attempt.stage === "analysis-copy") {
      assert.equal(attempt.name, "ShAnalyzeResourceError");
      assert.equal(attempt.code, "SH_ANALYSIS_RESOURCE");
      assert.equal(attempt.operation, "brace-observation-copy");
      assert.equal(attempt.cause, "RangeError");
      assert.equal(attempt.causeMessage, "Maximum call stack size exceeded");
    } else {
      assert.equal(attempt.stage, "binding-input");
      assert.equal(attempt.name, "ShInternalError");
      assert.equal(attempt.code, "SH_AST_INTERNAL");
      assert.equal(
        attempt.message,
        "SplitBraces input record depth 257 exceeds the bridge transport limit 256",
      );
    }
    assert.ok(
      typeof attempt.recordsUnchanged === "number" &&
        attempt.recordsUnchanged >= 8000,
    );
    assert.equal(attempt.reused, true);
  }
});
