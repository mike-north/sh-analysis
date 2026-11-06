/** Tooling contracts exercise the same commands contributors and CI use on future API sources. */
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";

/** An isolated project prevents hostile fixtures from modifying the checked package or parallel runs. */
const root = process.cwd();
mkdirSync(join(root, "temp"), { recursive: true });
const project = mkdtempSync(join(root, "temp/tooling-contract-"));
for (const path of [
  "src",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "eslint.config.ts",
  "api-extractor.json",
  "api-report",
]) {
  cpSync(join(root, path), join(project, path), { recursive: true });
}
symlinkSync(join(root, "node_modules"), join(project, "node_modules"));
after(() => {
  rmSync(project, { recursive: true, force: true });
});

/** Fixtures stay inside the worktree so the real TypeScript project service owns their types. */
function withFixture(
  directory: string,
  name: string,
  source: string,
  inspect: (path: string) => void,
): void {
  mkdirSync(join(project, directory), { recursive: true });
  const path = join(project, directory, name);
  writeFileSync(path, source);
  try {
    inspect(path);
  } finally {
    rmSync(path);
  }
}

/** Capture diagnostics without a shell so fixture text cannot alter command execution. */
function run(
  command: string,
  args: readonly string[],
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: project,
    env: { ...process.env, pnpm_config_verify_deps_before_run: "false" },
  });
}

/** Only the diagnostic fields needed by these behavioral assertions cross the CLI boundary. */
interface ILintMessage {
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
}

/** Array validation retains unknown element types until each diagnostic has been checked. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Validate CLI output before relying on it, including diagnostics without a rule ID. */
function isLintMessage(value: unknown): value is ILintMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "ruleId" in value &&
    (typeof value.ruleId === "string" || value.ruleId === null) &&
    "severity" in value &&
    typeof value.severity === "number" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/** Malformed or missing diagnostics are failures, never evidence that lint enforced a rule. */
function lintMessages(output: string): readonly ILintMessage[] {
  const result: unknown = JSON.parse(output);
  assert.ok(isUnknownArray(result));
  const [file] = result;
  assert.ok(typeof file === "object" && file !== null && "messages" in file);
  assert.ok(isUnknownArray(file.messages));
  assert.ok(file.messages.every(isLintMessage));
  return file.messages;
}

void test("lint rejects unsafe types and requires useful, used directive explanations across TypeScript files", () => {
  for (const directory of ["src", "test"]) {
    for (const extension of ["ts", "tsx", "mts", "cts"]) {
      withFixture(
        directory,
        `tooling-fixture.${extension}`,
        `
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const unsafe: any = JSON.parse('null');
export function implicit(value) { return value; }
export function accept(value: string): string { return value; }
accept(unsafe);
unsafe();
export const member: unknown = unsafe.member;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- No explicit any exists here.
export const safe = 1;
`,
        (path) => {
          const lint = run("pnpm", [
            "exec",
            "eslint",
            path,
            "--format",
            "json",
          ]);
          assert.equal(lint.status, 1, lint.stderr || lint.stdout);
          const messages = lintMessages(lint.stdout);
          assert.ok(
            messages.some(
              (message) =>
                message.severity === 2 &&
                message.message.includes("Unused eslint-disable"),
            ),
            lint.stdout,
          );
          const rules = messages.map((message) => message.ruleId);
          for (const rule of [
            "@eslint-community/eslint-comments/require-description",
            "@typescript-eslint/no-unsafe-assignment",
            "@typescript-eslint/no-unsafe-return",
            "@typescript-eslint/no-unsafe-argument",
            "@typescript-eslint/no-unsafe-call",
            "@typescript-eslint/no-unsafe-member-access",
          ]) {
            assert.ok(
              rules.includes(rule),
              `${path}: missing ${rule}: ${lint.stdout}`,
            );
          }
          writeFileSync(path, "export const unsafe: any = 1;\n");
          const explicit = run("pnpm", [
            "exec",
            "eslint",
            path,
            "--format",
            "json",
          ]);
          assert.equal(explicit.status, 1, explicit.stderr || explicit.stdout);
          assert.ok(
            lintMessages(explicit.stdout).some(
              (message) =>
                message.ruleId === "@typescript-eslint/no-explicit-any",
            ),
          );
          writeFileSync(
            path,
            `
/** A callback fixture demonstrates the narrowly documented exception. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- This callback boundary intentionally accepts every JavaScript argument type.
export type ICallback = (...args: any[]) => unknown;
export function narrow(value: unknown): string {
  return typeof value === "string" ? value : "";
}
`,
          );
          const safe = run("pnpm", [
            "exec",
            "eslint",
            path,
            "--max-warnings",
            "0",
          ]);
          assert.equal(safe.status, 0, safe.stdout + safe.stderr);
        },
      );
    }
  }
});

void test("type checking rejects implicit any in source and tests", () => {
  for (const directory of ["src", "test"]) {
    withFixture(
      directory,
      "tooling-fixture.ts",
      "export function identity(value) { return value; }\n",
      () => {
        const result = run("pnpm", ["check:typecheck"]);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /TS7006/);
      },
    );
  }
});

void test("API review check rejects a new public export without rewriting the approved report", () => {
  const reportPath = join(project, "api-report/sh-analysis.api.md");
  const approved = readFileSync(reportPath, "utf8");
  const entry = readFileSync(join(project, "src/index.ts"), "utf8");
  try {
    writeFileSync(
      join(project, "src/index.ts"),
      `${entry}\n/** A public surface change must appear in review. @public */\nexport declare const toolingFixture: string;\n`,
    );
    const build = run("pnpm", ["build"]);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const check = run("pnpm", ["check:api-report"]);
    assert.notEqual(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout + check.stderr, /API report|API signature/);
    assert.equal(readFileSync(reportPath, "utf8"), approved);
  } finally {
    writeFileSync(join(project, "src/index.ts"), entry);
    const rebuild = run("pnpm", ["build"]);
    assert.equal(rebuild.status, 0, rebuild.stdout + rebuild.stderr);
  }
});

void test("release commands execute TypeScript directly without a build or JavaScript fallback", () => {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(
    typeof manifest === "object" && manifest !== null && "scripts" in manifest,
  );
  const scripts = manifest.scripts;
  assert.ok(typeof scripts === "object" && scripts !== null);
  for (const name of ["release", "changesets", "versions"]) {
    const command = `check:${name}`;
    assert.ok(command in scripts);
    assert.equal(
      Reflect.get(scripts, command),
      `node --experimental-strip-types scripts/check-${name}.ts`,
    );
    assert.ok(readFileSync(`scripts/check-${name}.ts`, "utf8").length > 0);
  }
  assert.ok("test" in scripts);
  assert.equal(
    scripts.test,
    "node --experimental-strip-types --test test/*.test.ts",
  );
});
