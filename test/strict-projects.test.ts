/** Aggregate validation must type-check helper files in every authored test project, preserving tsd's negative assertions. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { object } from "./support.ts";

/** Full isolated snapshots exercise the actual aggregate command rather than an invented compiler invocation. */
const root = resolve(import.meta.dirname, "..");
await test("all test projects enforce strict noImplicitAny and aggregate check rejects helper TS7006", (t) => {
  mkdirSync(join(root, "temp"), { recursive: true });
  const dir = mkdtempSync(join(root, "temp/strict-project-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  for (const name of readdirSync(root)) {
    if (
      !["node_modules", "temp", "scratch", ".git", ".pnpm-store"].includes(name)
    )
      cpSync(join(root, name), join(dir, name), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  /** The aggregate command uses the snapshot manifest and its installed tools without mutating its lock. */
  function run(...args: string[]) {
    return spawnSync("pnpm", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, pnpm_config_verify_deps_before_run: "false" },
    });
  }
  /** Optional audit receipts retain actual command output without changing ordinary test artifacts. */
  function receipt(name: string, output: string): void {
    if (process.env.GATE_AUDIT_DIR)
      writeFileSync(join(process.env.GATE_AUDIT_DIR, name), output);
  }
  const build = run("build");
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const baseline = run("check");
  receipt("strict-baseline.log", baseline.stdout + baseline.stderr);
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  t.diagnostic("clean isolated aggregate baseline passed");
  for (const config of [
    "tsconfig.json",
    "tsconfig.test.json",
    "test-d/tsconfig.json",
  ]) {
    const result = run("exec", "tsc", "-p", config, "--showConfig");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    receipt(config.replaceAll("/", "-") + ".showConfig.json", result.stdout);
    const options = object(object(JSON.parse(result.stdout)).compilerOptions);
    assert.equal(options.strict, true);
    assert.equal(options.noImplicitAny, true);
  }
  for (const { helper, imported } of [
    { helper: "test/analysis/implicit-helper.ts", imported: false },
    { helper: "test-d/implicit-helper.ts", imported: true },
    { helper: "test-d/unimported-helper.ts", imported: false },
  ]) {
    const path = join(dir, helper);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      '/** A helper boundary must require an explicit input type. */\nexport function identity(value): boolean { return typeof value === "string"; }\n',
    );
    const entry = join(dir, "test-d/index.test-d.ts");
    const original = readFileSync(entry, "utf8");
    if (imported)
      writeFileSync(
        entry,
        original +
          '\nimport { identity } from "./implicit-helper.js";\nexpectType<boolean>(identity("x"));\n',
      );
    const format = run(
      "exec",
      "prettier",
      "--write",
      helper,
      "test-d/index.test-d.ts",
    );
    assert.equal(format.status, 0, format.stdout + format.stderr);
    try {
      const result = run("check");
      receipt(
        helper.replaceAll("/", "-") + ".check.log",
        result.stdout + result.stderr,
      );
      t.diagnostic(`${helper}: aggregate status ${String(result.status)}`);
      assert.notEqual(
        result.status,
        0,
        `${helper}: aggregate check passed an implicit parameter`,
      );
      if (imported) {
        // Ordinary tsc is a diagnostic oracle here, never the declaration-test gate:
        // its expected failures from negative tsd assertions must remain intact.
        const compiler = run(
          "exec",
          "tsc",
          "-p",
          "test-d/tsconfig.json",
          "--pretty",
          "false",
        );
        receipt(
          "declaration-helper-tsc.log",
          compiler.stdout + compiler.stderr,
        );
        assert.match(
          compiler.stdout + compiler.stderr,
          /implicit-helper\.ts.*TS7006/,
        );
      }
      assert.match(
        result.stdout + result.stderr,
        /TS7006|Parameter ['"]?value['"]? implicitly has an ['"]?any['"]? type/,
      );
    } finally {
      rmSync(path);
      writeFileSync(entry, original);
    }
  }
});
