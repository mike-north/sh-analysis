/** Release tests assert authorization and artifact outcomes independently of workflow execution. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertRelease } from "../scripts/release-contract.mjs";
import test from "node:test";
import { parse } from "yaml";

const repository = "mike-north/sh-analysis";
const approved = {
  name: "sh-analysis",
  version: "0.1.0",
  repository: { type: "git", url: `git+https://github.com/${repository}.git` },
};
const identity = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/main",
  RELEASE_VERSION: "0.1.0",
};

// Exercise the production authorization contract with hand-selected hostile contexts.
function guard(packageOverride = {}, environmentOverride = {}) {
  try {
    assertRelease(
      { ...approved, ...packageOverride },
      { ...identity, ...environmentOverride },
    );
    return { status: 0 };
  } catch {
    return { status: 1 };
  }
}

test("release accepts only the explicitly selected main-branch package version", () => {
  assert.equal(guard().status, 0);
  for (const environment of [
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REPOSITORY: "other/sh-analysis" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/v0.1.0" },
    { RELEASE_VERSION: "0.2.0" },
  ])
    assert.notEqual(
      guard({}, environment).status,
      0,
      JSON.stringify(environment),
    );
});

test("release refuses placeholders, non-0.x versions and incorrect package identities", () => {
  for (const version of [
    "0.0.0-stage",
    "0.0.0",
    "1.0.0",
    "0.1",
    "0.1.0-stage",
    "0.1.0+metadata",
  ]) {
    assert.notEqual(
      guard({ version }, { RELEASE_VERSION: version }).status,
      0,
      version,
    );
  }
  assert.notEqual(guard({ name: "other-package" }).status, 0);
  assert.notEqual(
    guard({ repository: { url: "git+https://github.com/other/repo.git" } })
      .status,
    0,
  );
});

test("workflow is manual-only and scopes OIDC to a GitHub-hosted publication job", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.publish["runs-on"], "ubuntu-latest");
  assert.deepEqual(workflow.jobs.publish.permissions, {
    contents: "read",
    "id-token": "write",
  });
  assert.equal(workflow.jobs.publish.environment, undefined);
  assert.equal(
    workflow.jobs.publish.if,
    "github.repository == 'mike-north/sh-analysis' && github.ref == 'refs/heads/main'",
  );
  const guardStep = workflow.jobs.publish.steps.find(
    (step) => step.run === "pnpm check:release",
  );
  assert.equal(guardStep?.env?.RELEASE_VERSION, "${{ inputs.version }}");
  assert.equal(stepsCacheDisabled(workflow), true);
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN|--provenance/);
  const steps = workflow.jobs.publish.steps;
  assert.ok(
    steps.some(
      (step) =>
        step.uses === "actions/setup-node@v4" &&
        step.with["node-version"] === 24,
    ),
  );
  const commands = steps
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
  for (const required of [
    "pnpm build",
    "pnpm check",
    "pnpm test",
    "pnpm check:release",
    "npm pack --dry-run",
    "npm publish",
  ]) {
    assert.ok(commands.includes(required), required);
  }
  assert.ok(commands.indexOf("pnpm test") < commands.indexOf("npm publish"));
  assert.ok(
    commands.indexOf("pnpm check:release") < commands.indexOf("npm publish"),
  );
});

test("release package contains executable and declaration entry points from a real build", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const files = pack.files.map((file) => file.path);
  for (const path of [
    "dist/index.js",
    "dist/index.d.ts",
    "README.md",
    "LICENSE",
  ]) {
    assert.ok(files.includes(path), `Missing packaged artifact: ${path}`);
  }
  assert.ok(
    !files.some(
      (path) => path.startsWith("test/") || path.startsWith("scripts/"),
    ),
  );
  await import("../dist/index.js");
});

/** Publishing must install from the checked-in lock rather than restored caches. */
function stepsCacheDisabled(workflow) {
  const setup = workflow.jobs.publish.steps.find(
    (step) => step.uses === "actions/setup-node@v4",
  );
  return (
    setup?.with?.["package-manager-cache"] === false &&
    setup.with.cache === undefined
  );
}

test("ordinary validation runs on pull requests without publication authority", () => {
  const workflow = parse(readFileSync(".github/workflows/check.yml", "utf8"));
  assert.ok(workflow.on.pull_request);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions?.["id-token"], undefined);
    assert.doesNotMatch(JSON.stringify(job), /npm publish/);
  }
  const commands = workflow.jobs.validate.steps
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
  for (const command of ["pnpm build", "pnpm check", "pnpm test"])
    assert.ok(commands.includes(command));
});
