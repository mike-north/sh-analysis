/** The real host copy refusal is exercised outside the test runner with an ordinary Node stack. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("a valid deep Word refuses through the analysis-owned copy boundary without mutation or poisoning reuse", () => {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./fixtures/brace-copy-resource-child.mjs", import.meta.url),
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
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.attempts.length, 3);
  for (const attempt of observed.attempts) {
    assert.equal(attempt.code, "SH_ANALYSIS_RESOURCE");
    assert.equal(attempt.operation, "brace-observation-copy");
    assert.equal(attempt.cause, "RangeError");
    assert.ok(attempt.recordsUnchanged >= 8000);
    assert.equal(attempt.reused, true);
  }
});
