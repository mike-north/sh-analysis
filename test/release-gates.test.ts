/** Owner policy is exercised against real manifests, Changesets plans, and CLI exits. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { object, workflow } from "./support.ts";

const root = resolve(import.meta.dirname, "..");
const policy =
  /stays in the 0\.x series until the owner declares the shape stable.*no override flag/is;

// Fixtures live inside the worktree and outside the repository's publishable sources.
function fixture(
  t: TestContext,
  { version = "0.4.0", bump = "minor" } = {},
): string {
  mkdirSync(join(root, "temp"), { recursive: true });
  const directory = mkdtempSync(join(root, "temp/.release-gate-"));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  // Give Changesets its own base ref; tests must not inherit refs from the enclosing worktree.
  for (const args of [
    ["init", "--initial-branch=main"],
    [
      "-c",
      "user.name=Mike North",
      "-c",
      "user.email=michael.l.north@gmail.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "--author=Mike North <michael.l.north@gmail.com>",
      "-m",
      "Establish release gate fixture",
    ],
  ]) {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  mkdirSync(join(directory, ".changeset"));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "fixture", version }),
  );
  writeFileSync(
    join(directory, ".changeset/config.json"),
    readFileSync(join(root, ".changeset/config.json")),
  );
  writeFileSync(
    join(directory, ".changeset/outcome.md"),
    `---\n"fixture": ${bump}\n---\nObservable change.\n`,
  );
  return directory;
}

function run(script: string, directory: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(root, "scripts", script)],
    {
      cwd: directory,
      encoding: "utf8",
    },
  );
}

await test("G1 refuses major declarations, including nested files and unknown packages", (t) => {
  const directory = fixture(t, { bump: "major" });
  const result = run("check-changesets.ts", directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, policy);
  writeFileSync(
    join(directory, ".changeset/outcome.md"),
    "---\nfixture: minor\n---\nSafe.\n",
  );
  mkdirSync(join(directory, ".changeset/nested"));
  writeFileSync(
    join(directory, ".changeset/nested/blocked.md"),
    "---\n'@other/package': major\n---\nBlocked.\n",
  );
  const nested = run("check-changesets.ts", directory);
  assert.notEqual(nested.status, 0);
  assert.match(nested.stderr, policy);
});

await test("G2 refuses current public versions at or beyond 1.0, including prereleases", (t) => {
  for (const version of ["1.0.0", "2.0.0", "1.0.0-rc.1"]) {
    const result = run("check-versions.ts", fixture(t, { version }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, policy);
  }
});

await test("G2 discovers nested public manifests but permits private packages", (t) => {
  const directory = fixture(t);
  mkdirSync(join(directory, "tools/nested"), { recursive: true });
  const manifest = join(directory, "tools/nested/package.json");
  writeFileSync(manifest, JSON.stringify({ name: "nested", version: "1.0.0" }));
  const blocked = run("check-versions.ts", directory);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, policy);
  writeFileSync(
    manifest,
    JSON.stringify({ name: "nested", version: "2.0.0", private: true }),
  );
  const allowed = run("check-versions.ts", directory);
  assert.equal(allowed.status, 0, allowed.stderr);
});

await test("G2 rejects the real next Changesets version even when current manifests are 0.x", (t) => {
  const directory = fixture(t, { bump: "major" });
  // A documentation-like suffix must not hide a real changeset from planning.
  renameSync(
    join(directory, ".changeset/outcome.md"),
    join(directory, ".changeset/feature-README.md"),
  );
  const result = run("check-versions.ts", directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /1\.0\.0/);
  assert.match(result.stderr, policy);
});

await test("0.x plus minor passes both gates and Changesets prepares a version and changelog", (t) => {
  const directory = fixture(t);
  for (const script of ["check-changesets.ts", "check-versions.ts"]) {
    const result = run(script, directory);
    assert.equal(result.status, 0, result.stderr);
  }
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules/@changesets/cli/bin.js"), "version"],
    { cwd: directory, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    object(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")))
      .version,
    "0.5.0",
  );
  assert.match(
    readFileSync(join(directory, "CHANGELOG.md"), "utf8"),
    /0\.5\.0[\s\S]*Observable change/,
  );
});

await test("invalid changesets and versions fail closed", (t) => {
  const directory = fixture(t);
  writeFileSync(join(directory, ".changeset/outcome.md"), "not frontmatter");
  assert.notEqual(run("check-changesets.ts", directory).status, 0);
  const invalid = fixture(t, { version: "not-a-version" });
  assert.notEqual(run("check-versions.ts", invalid).status, 0);
});

await test("no pending changesets permits tooling-only commits and prepared 0.x releases", (t) => {
  const directory = fixture(t);
  rmSync(join(directory, ".changeset/outcome.md"));
  for (const script of ["check-changesets.ts", "check-versions.ts"]) {
    const result = run(script, directory);
    assert.equal(result.status, 0, result.stderr);
  }
});

await test("publication entry point enforces the same ceiling before checking dispatch identity", (t) => {
  const directory = fixture(t);
  cpSync(join(root, "scripts"), join(directory, "scripts"), {
    recursive: true,
  });
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
  mkdirSync(join(directory, "dist/package"), { recursive: true });
  writeFileSync(
    join(directory, "dist/package/package.json"),
    JSON.stringify({ name: "artifact", version: "1.0.0" }),
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(directory, "scripts/check-release.ts")],
    { cwd: directory, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, policy);
  assert.match(result.stderr, /artifact|dist\/package\/package.json/);
});

await test("CI runs both gates on every PR and main push, release guards before publication", () => {
  const ci = workflow(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  assert.ok(Object.hasOwn(ci.on, "pull_request"));
  assert.deepEqual(object(ci.on.push).branches, ["main"]);
  const checkout = ci.jobs.check.steps.find(
    (step) => step.uses === "actions/checkout@v4",
  );
  assert.ok(checkout);
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.ok(
    ci.jobs.check.steps.some(
      (step) =>
        step.if === "github.event_name == 'pull_request'" &&
        step.run === "git branch main origin/main",
    ),
  );
  const commands = ci.jobs.check.steps
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
  for (const command of [
    "pnpm check:changesets",
    "pnpm check:versions",
    "pnpm build",
    "pnpm check",
    "pnpm test",
  ])
    assert.ok(commands.includes(command), command);
  const release = workflow(
    readFileSync(join(root, ".github/workflows/release.yml"), "utf8"),
  );
  const steps = release.jobs.publish.steps;
  const guard = steps.findIndex((step) => step.run === "pnpm check:release");
  const publish = steps.findIndex((step) => step.run?.includes("npm publish"));
  assert.ok(guard >= 0 && guard < publish);
  assert.ok(!steps[guard]["continue-on-error"]);
  const scripts = object(
    object(JSON.parse(readFileSync(join(root, "package.json"), "utf8")))
      .scripts,
  );
  assert.equal(typeof scripts["version:prepare"], "string");
  const prepare = scripts["version:prepare"];
  assert.ok(typeof prepare === "string");
  assert.match(
    prepare,
    /check:changesets.*check:versions.*changeset version.*check:versions/,
  );
});
