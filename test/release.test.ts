/** Release tests assert authorization and artifact outcomes independently of workflow execution. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertRelease } from "../scripts/release-contract.ts";
import test from "node:test";
import {
  object,
  objects,
  workflow as readWorkflow,
  type IWorkflow,
} from "./support.ts";

const repository = "mike-north/sh-analysis";
const approved = {
  name: "sh-analysis",
  version: "0.1.0",
  repository: { type: "git", url: `git+https://github.com/${repository}.git` },
};
const identity = {
  GITHUB_EVENT_NAME: "push",
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/main",
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

await test("release accepts only a push to main of the trusted repository", () => {
  assert.equal(guard().status, 0);
  for (const environment of [
    { GITHUB_EVENT_NAME: "workflow_dispatch" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REPOSITORY: "other/sh-analysis" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/v0.1.0" },
  ])
    assert.notEqual(
      guard({}, environment).status,
      0,
      JSON.stringify(environment),
    );
});

await test("release refuses placeholders, non-0.x versions and incorrect package identities", () => {
  for (const version of [
    "0.0.0-stage",
    "0.0.0",
    "1.0.0",
    "0.1",
    "0.1.0-stage",
    "0.1.0+metadata",
  ]) {
    assert.notEqual(guard({ version }).status, 0, version);
  }
  assert.notEqual(guard({ name: "other-package" }).status, 0);
  assert.notEqual(
    guard({ repository: { url: "git+https://github.com/other/repo.git" } })
      .status,
    0,
  );
});

await test("workflow releases on push to main through the Changesets action without a GitHub environment", () => {
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  const workflow = readWorkflow(source);
  // npm trusted publishing is registered against this file name with no environment.
  assert.deepEqual(Object.keys(workflow.on), ["push"]);
  assert.deepEqual(object(workflow.on.push).branches, ["main"]);
  assert.deepEqual(workflow.permissions, {
    contents: "write",
    "pull-requests": "write",
    "id-token": "write",
  });
  const job = workflow.jobs.release;
  assert.ok(job);
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job.environment, undefined);
  assert.equal(job.if, "github.repository == 'mike-north/sh-analysis'");
  assert.equal(stepsCacheDisabled(workflow), true);
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN|--provenance/);
  assert.doesNotMatch(source, /workflow_dispatch|inputs\./);
  const steps = job.steps;
  assert.ok(
    steps.some(
      (step) =>
        step.uses === "actions/setup-node@v4" &&
        step.with["node-version"] === 24,
    ),
  );
  const action = steps.find(
    (step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("changesets/action@"),
  );
  assert.ok(action);
  assert.equal(action.with.version, "pnpm version-packages");
  assert.equal(action.with.publish, "pnpm release");
  const install = steps.findIndex((step) => step.run?.includes("pnpm install"));
  assert.ok(install >= 0 && install < steps.indexOf(action));
});

await test("release script builds, checks, tests and guards before changeset publish", () => {
  const scripts = object(
    object(JSON.parse(readFileSync("package.json", "utf8"))).scripts,
  );
  const release = scripts.release;
  assert.ok(typeof release === "string");
  const order = [
    "pnpm build",
    "pnpm check",
    "pnpm test",
    "pnpm check:release",
    "changeset publish",
  ].map((command) => release.indexOf(command));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

await test("release package contains executable and declaration entry points from a real build", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = objects(JSON.parse(result.stdout));
  assert.ok(pack);
  const files = objects(pack.files).map((file) => {
    assert.ok(typeof file.path === "string");
    return file.path;
  });
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
function stepsCacheDisabled(workflow: IWorkflow) {
  const setup = workflow.jobs.release.steps.find(
    (step) => step.uses === "actions/setup-node@v4",
  );
  return (
    setup?.with["package-manager-cache"] === false &&
    setup.with.cache === undefined
  );
}

void test("ordinary validation runs on pull requests without publication authority", () => {
  const workflow = readWorkflow(
    readFileSync(".github/workflows/check.yml", "utf8"),
  );
  assert.ok(workflow.on.pull_request);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(object(job.permissions ?? {})["id-token"], undefined);
    assert.doesNotMatch(JSON.stringify(job), /npm publish/);
  }
  const commands = workflow.jobs.validate.steps
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
  for (const command of ["pnpm build", "pnpm check", "pnpm test"])
    assert.ok(commands.includes(command));
});
