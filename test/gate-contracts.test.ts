/** Snapshot release policy is independent of Git eligibility and uses actual CLI preparation as its oracle. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { fixtureChangesetConfig, object } from "./support.ts";

/** Ancestor audits supply archived scripts without changing any ancestor branch. */
const root = resolve(import.meta.dirname, "..");
const scripts = process.env.GATE_SCRIPTS ?? join(root, "scripts");
const extension = process.env.GATE_EXTENSION ?? "ts";
const cli = join(root, "node_modules/@changesets/cli/bin.js");

/** Every fixture owns its Git graph and source tree; the installed tooling alone is shared. */
function fixture(t: TestContext, bump: string | null = "minor"): string {
  const temp = realpathSync(tmpdir());
  const fromRoot = relative(realpathSync(root), temp);
  if (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  ) {
    throw new Error(
      "Gate contract fixture temporary directory must be outside the repository",
    );
  }
  const dir = mkdtempSync(join(temp, "gate-contract-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  // Keep formatter discovery tied to the installed tools without inheriting the workspace.
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  mkdirSync(join(dir, ".changeset"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.8.0", type: "module" }),
  );
  writeFileSync(
    join(dir, ".changeset/config.json"),
    fixtureChangesetConfig(root),
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
    "user.name=Fixture Author",
    "-c",
    "user.email=fixture@example.com",
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
/** Compare manifests around real CLI preparation; no history eligibility or planner JSON is involved. */
function oracle(t: TestContext, dir: string): Record<string, unknown>[] {
  const copy = fixture(t, null);
  rmSync(join(copy, ".changeset"), { recursive: true });
  for (const name of readdirSync(dir))
    if (name !== ".git" && name !== "node_modules")
      cpSync(join(dir, name), join(copy, name), { recursive: true });
  /** Discover fixture manifests before and after preparation, including workspace dependents. */
  function manifests(directory: string): Map<string, unknown> {
    const result = new Map<string, unknown>();
    function visit(path: string): void {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) visit(child);
        else if (entry.name === "package.json") {
          const manifest = object(JSON.parse(readFileSync(child, "utf8")));
          if (typeof manifest.name === "string")
            result.set(manifest.name, manifest.version);
        }
      }
    }
    visit(directory);
    return result;
  }
  const before = manifests(copy);
  const prepared = changeset(copy, "version");
  // v3 refuses a declaration-free preparation before assembly, while the snapshot
  // policy still permits it. Only this explicit no-work result is a valid oracle.
  if (prepared.status !== 0) {
    assert.equal(prepared.status, 1, prepared.stdout + prepared.stderr);
    assert.match(
      prepared.stdout + prepared.stderr,
      /No unreleased changesets found/,
    );
  }
  const releases = [...manifests(copy)].flatMap(([name, version]) =>
    before.get(name) === version
      ? []
      : [{ name, oldVersion: before.get(name), newVersion: version }],
  );
  if (prepared.status !== 0) assert.deepEqual(releases, []);
  // The adapter's complete public plan must agree with observed CLI preparation,
  // including dependent releases and legitimate empty snapshots.
  const snapshot = command(dir, process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `const { readReleasePlan } = await import(${JSON.stringify(pathToFileURL(join(scripts, "release-plan.ts")).href)}); console.log(JSON.stringify(await readReleasePlan(process.cwd())));`,
  ]);
  assert.equal(snapshot.status, 0, snapshot.stdout + snapshot.stderr);
  const plan = object(JSON.parse(snapshot.stdout));
  assert.ok(Array.isArray(plan.releases));
  const planned = plan.releases.map((entry: unknown) => {
    const release = object(entry);
    return {
      name: release.name,
      oldVersion: release.oldVersion,
      newVersion: release.newVersion,
    };
  });
  assert.deepEqual(
    planned.sort((left, right) =>
      String(left.name).localeCompare(String(right.name)),
    ),
    releases.sort((left, right) => left.name.localeCompare(right.name)),
  );
  t.diagnostic(
    `Changesets CLI 3.0.3 preparation oracle (exit ${String(prepared.status)}): ${JSON.stringify(releases)}`,
  );
  return releases;
}

await test("release tooling pins the public Changesets v3 snapshot stack without a v2 helper", () => {
  const dependencies = object(
    object(JSON.parse(readFileSync(join(root, "package.json"), "utf8")))
      .devDependencies,
  );
  for (const [name, version] of Object.entries({
    "@changesets/cli": "3.0.3",
    "@changesets/assemble-release-plan": "7.0.0",
    "@changesets/config": "4.0.1",
    "@changesets/read": "1.0.1",
    "@changesets/pre": "3.0.0",
    "@manypkg/get-packages": "3.1.0",
  }))
    assert.equal(dependencies[name], version, name);
  assert.equal(dependencies["@changesets/get-release-plan"], undefined);
});

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
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
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
  // v3 projects an out-of-range peer as a patch here; actual CLI preparation
  // establishes that projection independently of the snapshot adapter.
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
      (entry) => entry.name === "dependent" && entry.newVersion === "0.3.1",
    ),
  );
  const peerResult = gate(dir);
  assert.equal(peerResult.status, 0, peerResult.stdout + peerResult.stderr);
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

await test("every planned version is inspected even after an allowed workspace release", (t) => {
  const dir = fixture(t, null);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "workspace",
      private: true,
      workspaces: ["packages/*"],
    }),
  );
  for (const name of ["allowed", "blocked"]) {
    mkdirSync(join(dir, "packages", name), { recursive: true });
    writeFileSync(
      join(dir, "packages", name, "package.json"),
      JSON.stringify({ name, version: "0.8.0" }),
    );
  }
  writeFileSync(
    join(dir, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n",
  );
  writeFileSync(
    join(dir, ".changeset/intent.md"),
    "---\nallowed: patch\nblocked: major\n---\nOutcome.\n",
  );
  const prepared = oracle(t, dir);
  assert.ok(
    prepared.some(
      (entry) => entry.name === "allowed" && entry.newVersion === "0.8.1",
    ),
  );
  assert.ok(
    prepared.some(
      (entry) => entry.name === "blocked" && entry.newVersion === "1.0.0",
    ),
  );
  const result = gate(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Changesets next version for blocked/);
});

await test("valid JSON with invalid Changesets configuration fails closed without declarations", (t) => {
  const dir = fixture(t, null);
  const configPath = join(dir, ".changeset/config.json");
  const config = object(JSON.parse(readFileSync(configPath, "utf8")));
  writeFileSync(configPath, JSON.stringify({ ...config, access: "invalid" }));
  const result = gate(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /access/);
});

await test("real changeset read and planner errors fail closed", (t) => {
  for (const declaration of [
    "not frontmatter",
    "---\nunknown-package: minor\n---\nOutcome.\n",
  ]) {
    const dir = fixture(t, null);
    writeFileSync(join(dir, ".changeset/invalid.md"), declaration);
    const result = gate(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot compute Changesets release plan/);
  }
});

await test("snapshot planning needs neither committed history nor a main ref", (t) => {
  const dir = fixture(t);
  rmSync(join(dir, ".git"), { recursive: true });
  git(dir, "init", "--initial-branch=topic");
  assert.notEqual(command(dir, "git", ["rev-parse", "HEAD"]).status, 0);
  assert.notEqual(
    command(dir, "git", ["show-ref", "--verify", "refs/heads/main"]).status,
    0,
  );
  assert.ok(oracle(t, dir).some((entry) => entry.newVersion === "0.9.0"));
  const result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

await test("CLI prerelease entry without declarations has an empty snapshot plan", (t) => {
  const dir = fixture(t, null);
  const entered = changeset(dir, "pre", "enter", "rc");
  assert.equal(entered.status, 0, entered.stdout + entered.stderr);
  assert.deepEqual(oracle(t, dir), []);
  const result = gate(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
