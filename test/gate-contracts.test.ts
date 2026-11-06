/** Snapshot release policy is independent of Git eligibility and uses actual CLI preparation as its oracle. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { object } from "./support.ts";

/** Ancestor audits supply archived scripts without changing any ancestor branch. */
const root = resolve(import.meta.dirname, "..");
const scripts = process.env.GATE_SCRIPTS ?? join(root, "scripts");
const extension = process.env.GATE_EXTENSION ?? "ts";
const cli = join(root, "node_modules/@changesets/cli/bin.js");

/** Every fixture owns its Git graph and source tree; the installed tooling alone is shared. */
function fixture(t: TestContext, bump: string | null = "minor"): string {
  mkdirSync(join(root, "temp"), { recursive: true });
  const dir = mkdtempSync(join(root, "temp/gate-contract-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, ".changeset"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.8.0", type: "module" }),
  );
  cpSync(
    join(root, ".changeset/config.json"),
    join(dir, ".changeset/config.json"),
  );
  if (bump !== null)
    writeFileSync(
      join(dir, ".changeset/intent.md"),
      `---\nfixture: ${bump}\n---\nOutcome.\n`,
    );
  git(dir, "init", "--initial-branch=topic");
  commit(dir);
  return dir;
}

/** Commands capture diagnostics at the process boundary without shell interpolation. */
function command(dir: string, program: string, args: string[]) {
  return spawnSync(program, args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, pnpm_config_verify_deps_before_run: "false" },
  });
}
/** Git operations never inherit the enclosing repository's refs. */
function git(dir: string, ...args: string[]): void {
  const result = command(dir, "git", args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
/** Commit complete snapshots so eligibility and planning can be varied independently. */
function commit(dir: string): void {
  git(dir, "add", ".");
  git(
    dir,
    "-c",
    "user.name=Mike North",
    "-c",
    "user.email=michael.l.north@gmail.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-m",
    "Record fixture snapshot",
  );
}
/** CLI failures are preserved rather than interpreted as an empty plan. */
function changeset(dir: string, ...args: string[]) {
  return command(dir, process.execPath, [cli, ...args]);
}
/** Run the shipped entry point, including its error handling. */
function gate(dir: string, name = "versions") {
  return command(dir, process.execPath, [
    "--experimental-strip-types",
    join(scripts, `check-${name}.${extension}`),
  ]);
}
/** An oracle copy gets a same-snapshot main ref solely for CLI status's unrelated eligibility check. */
function oracle(t: TestContext, dir: string): Record<string, unknown>[] {
  const copy = fixture(t, null);
  rmSync(join(copy, ".changeset"), { recursive: true });
  for (const name of readdirSync(dir))
    if (name !== ".git" && name !== "node_modules")
      cpSync(join(dir, name), join(copy, name), { recursive: true });
  commit(copy);
  git(copy, "branch", "main");
  const result = changeset(copy, "status", "--output", "plan.json");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const plan = object(
    JSON.parse(readFileSync(join(copy, "plan.json"), "utf8")),
  );
  assert.ok(Array.isArray(plan.releases));
  const releases = plan.releases.map((entry: unknown) => object(entry));
  t.diagnostic(
    `Changesets CLI 2.29.8 status oracle: ${JSON.stringify(releases)}`,
  );
  const prepared = changeset(copy, "version");
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  for (const entry of releases) {
    const manifestPath =
      entry.name === "fixture"
        ? join(copy, "package.json")
        : join(copy, "packages", String(entry.name), "package.json");
    assert.equal(
      object(JSON.parse(readFileSync(manifestPath, "utf8"))).version,
      entry.newVersion,
    );
  }
  return releases;
}

await test("CLI-generated empty changesets and prose major are intent-free", (t) => {
  const dir = fixture(t, null);
  const result = changeset(dir, "add", "--empty");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const file = readdirSync(join(dir, ".changeset")).find((name) =>
    name.endsWith(".md"),
  );
  assert.ok(file);
  const path = join(dir, ".changeset", file);
  const bytes = readFileSync(path, "utf8");
  assert.equal(bytes, "---\n---\n");
  for (const prose of ["", "\nA major improvement in prose.\n"]) {
    writeFileSync(path, bytes + prose);
    const check = gate(dir, "changesets");
    assert.equal(check.status, 0, check.stdout + check.stderr);
  }
  writeFileSync(path, "---\nfixture: major\n---\nNo prose.\n");
  assert.notEqual(gate(dir, "changesets").status, 0);
});

await test("snapshot plans work without main, detached/shallow and with empty intent", async (t) => {
  for (const bump of ["minor", "major", "empty"]) {
    await t.test(bump, async (t) => {
      const dir = fixture(t, bump === "empty" ? null : bump);
      if (bump === "empty") {
        assert.equal(changeset(dir, "add", "--empty").status, 0);
        commit(dir);
      }
      const expected = oracle(t, dir);
      assert.deepEqual(
        expected.map((entry) => entry.newVersion),
        bump === "minor" ? ["0.9.0"] : bump === "major" ? ["1.0.0"] : [],
      );
      const clone = fixture(t, null);
      rmSync(clone, { recursive: true, force: true });
      git(root, "clone", "--depth=1", `file://${dir}`, clone);
      git(clone, "checkout", "--detach");
      assert.equal(
        command(clone, "git", [
          "rev-parse",
          "--is-shallow-repository",
        ]).stdout.trim(),
        "true",
      );
      for (const snapshot of [dir, clone]) {
        await t.test(snapshot === dir ? "no main" : "shallow detached", () => {
          const result = gate(snapshot);
          assert.equal(
            result.status === 0,
            bump !== "major",
            result.stdout + result.stderr,
          );
          if (bump === "major") assert.match(result.stderr, /1\.0\.0/);
        });
      }
    });
  }
});

await test("consumed Version Packages history has a real empty next plan", (t) => {
  const dir = fixture(t);
  git(dir, "branch", "main");
  assert.equal(changeset(dir, "version").status, 0);
  commit(dir);
  assert.deepEqual(oracle(t, dir), []);
  const result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

await test("CLI-produced prerelease exit with no declarations has an empty plan", (t) => {
  const dir = fixture(t, null);
  assert.equal(changeset(dir, "pre", "enter", "rc").status, 0);
  assert.equal(changeset(dir, "pre", "exit").status, 0);
  assert.deepEqual(oracle(t, dir), []);
  const result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

await test("CLI-produced prerelease exit checks an actual next major from a current 0.x snapshot", (t) => {
  const dir = fixture(t, "major");
  assert.equal(changeset(dir, "pre", "enter", "rc").status, 0);
  assert.equal(changeset(dir, "pre", "exit").status, 0);
  const plan = oracle(t, dir);
  assert.ok(plan.some((entry) => entry.newVersion === "1.0.0"));
  const result = gate(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1\.0\.0/);
});

await test("CLI-consumed prerelease declarations produce no new prerelease and then a stable exit", (t) => {
  const dir = fixture(t);
  assert.equal(changeset(dir, "pre", "enter", "rc").status, 0);
  assert.equal(changeset(dir, "version").status, 0);
  assert.equal(
    object(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).version,
    "0.9.0-rc.0",
  );
  assert.deepEqual(oracle(t, dir), []);
  let result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(changeset(dir, "pre", "exit").status, 0);
  const plan = oracle(t, dir);
  assert.ok(plan.some((entry) => entry.newVersion === "0.9.0"));
  result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(changeset(dir, "version").status, 0);
  assert.deepEqual(oracle(t, dir), []);
  result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

await test("real workspace dependent bumps are included in the ceiling", (t) => {
  const dir = fixture(t, null);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "workspace",
      private: true,
      workspaces: ["packages/*"],
    }),
  );
  for (const [name, manifest] of Object.entries({
    core: { name: "core", version: "0.8.0" },
    dependent: {
      name: "dependent",
      version: "0.3.0",
      dependencies: { core: "0.8.0" },
    },
  })) {
    mkdirSync(join(dir, "packages", name), { recursive: true });
    writeFileSync(
      join(dir, "packages", name, "package.json"),
      JSON.stringify(manifest),
    );
  }
  writeFileSync(
    join(dir, ".changeset/intent.md"),
    "---\ncore: minor\n---\nOutcome.\n",
  );
  const plan = oracle(t, dir);
  assert.ok(
    plan.some((entry) => entry.name === "core" && entry.newVersion === "0.9.0"),
  );
  assert.ok(
    plan.some(
      (entry) => entry.name === "dependent" && entry.newVersion === "0.3.1",
    ),
  );
  const result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // A peer dependent can cross the ceiling even though the requested package stays 0.x.
  // No major declaration names this dependent; the real planner must discover the bump.
  writeFileSync(
    join(dir, "packages/dependent/package.json"),
    JSON.stringify({
      name: "dependent",
      version: "0.3.0",
      peerDependencies: { core: "0.8.0" },
    }),
  );
  const peerPlan = oracle(t, dir);
  assert.ok(
    peerPlan.some(
      (entry) => entry.name === "core" && entry.newVersion === "0.9.0",
    ),
  );
  assert.ok(
    peerPlan.some(
      (entry) => entry.name === "dependent" && entry.newVersion === "1.0.0",
    ),
  );
  const peerResult = gate(dir);
  assert.notEqual(peerResult.status, 0);
  assert.match(peerResult.stderr, /Changesets next version for dependent/);
});

/** The contract accepts untrusted version fields and either returns or refuses authorization. */
function isValidator(
  value: unknown,
): value is (version: unknown, source: unknown) => void {
  return typeof value === "function";
}

await test("strict SemVer validates exact current and planned version strings independently of the ceiling", async (t) => {
  const contract: unknown = await import(
    pathToFileURL(join(scripts, `release-contract.${extension}`)).href
  );
  assert.ok(
    typeof contract === "object" &&
      contract !== null &&
      "assertZeroVersion" in contract &&
      isValidator(contract.assertZeroVersion),
  );
  const validate = contract.assertZeroVersion;
  for (const value of [
    "0.8.0-rc..1",
    "0.8.0-01",
    "0.8.0-rc.01",
    "0.8.0-",
    "0.8.0+",
    "0.8.0+a..b",
    "00.8.0",
    "0.08.0",
    "v0.8.0",
    "=0.8.0",
    " 0.8.0",
    "0.8.0 ",
    "1.0.0-rc.1",
  ]) {
    assert.throws(() => {
      validate(value, "planned version");
    }, value);
    const dir = fixture(t, null);
    const manifest = join(dir, "package.json");
    writeFileSync(
      manifest,
      JSON.stringify({ name: "fixture", version: value }),
    );
    assert.notEqual(gate(dir).status, 0, value);
  }
  for (const value of [
    "0.8.0",
    "0.8.0-rc.1",
    "0.8.0-0",
    "0.8.0-01a",
    "0.8.0+001.02",
    "0.8.0-rc.1+build.001",
  ]) {
    assert.doesNotThrow(() => {
      validate(value, "planned version");
    }, value);
    const dir = fixture(t, null);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", version: value }),
    );
    const result = gate(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

await test("snapshot planning fails closed on real Changesets configuration and package errors", (t) => {
  const dir = fixture(t, null);
  writeFileSync(join(dir, ".changeset/config.json"), "{");
  assert.notEqual(gate(dir).status, 0);
});
