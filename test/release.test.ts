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

await test("workflow selects a mode, then versions or publishes in jobs with separate authority", () => {
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  const workflow = readWorkflow(source);
  // npm trusted publishing is registered against this file name with no environment.
  assert.deepEqual(Object.keys(workflow.on), ["push"]);
  assert.deepEqual(object(workflow.on.push).branches, ["main"]);
  // No workflow-wide authority: every job grants itself only what it needs.
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), [
    "select-mode",
    "version",
    "publish",
  ]);
  const { "select-mode": select, version, publish } = workflow.jobs;

  // Per-job permissions, from the action's documented requirements: selection reads only,
  // versioning writes the version commit and its pull request, publication writes tags and
  // releases and is the only job that may mint the OIDC token.
  assert.deepEqual(select.permissions, { contents: "read" });
  assert.deepEqual(version.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  assert.deepEqual(publish.permissions, {
    contents: "write",
    "id-token": "write",
  });

  // Only the publish job runs in the trusted-publisher context, which has no environment.
  for (const job of [select, version, publish]) {
    assert.equal(job.environment, undefined);
    assert.equal(job["runs-on"], "ubuntu-latest");
  }
  assert.equal(select.if, "github.repository == 'mike-north/sh-analysis'");
  assert.deepEqual(version.needs, "select-mode");
  assert.deepEqual(publish.needs, "select-mode");
  assert.equal(version.if, "needs.select-mode.outputs.mode == 'version'");
  assert.equal(publish.if, "needs.select-mode.outputs.mode == 'publish'");

  assert.equal(stepsCacheDisabled(workflow), true);
  assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN|--provenance/);
  assert.doesNotMatch(source, /workflow_dispatch|inputs\./);
  assert.doesNotMatch(source, /changesets\/action@/);

  // Every third-party action is pinned by full commit SHA, and the three Changesets
  // sub-actions share one SHA (v2.1.2) so selection, versioning and publication agree.
  const everyUses = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.flatMap((step) =>
      typeof step.uses === "string" ? [step.uses] : [],
    ),
  );
  for (const uses of everyUses)
    assert.match(uses, /^[^@]+@[0-9a-f]{40}$/, uses);
  const changesetsRefs = everyUses.filter((uses) =>
    uses.startsWith("changesets/action/"),
  );
  assert.deepEqual(changesetsRefs.map((uses) => uses.split("@")[0]).sort(), [
    "changesets/action/publish",
    "changesets/action/select-mode",
    "changesets/action/version",
  ]);
  assert.deepEqual(
    [...new Set(changesetsRefs.map((uses) => uses.split("@")[1]))],
    ["ae32849d5ba541f9ae29e40e22a623bc13562f51"],
  );
  assert.match(source, /changesets\/action\/\S+@\S+ # v2\.1\.2/);

  for (const job of [select, version, publish]) {
    const setup = job.steps.find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/setup-node@"),
    );
    assert.equal(setup?.with["node-version"], 24);
    // The action pushes through the GitHub API; no job needs persisted checkout credentials.
    const checkout = job.steps.find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@"),
    );
    assert.equal(checkout?.with["persist-credentials"], false);
  }
  assert.equal(
    version.steps.find((step) => String(step.uses).includes("checkout"))?.with[
      "fetch-depth"
    ],
    0,
  );

  const action = (job: typeof publish, name: string) => {
    const found = job.steps.find(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith(`changesets/action/${name}@`),
    );
    assert.ok(found, name);
    return found;
  };
  assert.equal(action(version, "version").with.script, "pnpm version-packages");
  assert.equal(action(version, "version").with["pr-title"], "Version Packages");
  assert.equal(
    action(version, "version").with["commit-message"],
    "Version Packages",
  );
  // The changelog generator reads pull request metadata with the workflow token.
  assert.equal(
    action(version, "version").with["github-token"],
    "${{ secrets.GITHUB_TOKEN }}",
  );

  // Publication runs the guarded release script, and asks the action for the tags and GitHub
  // Releases that the Changesets CLI 3 no longer announces in its own output.
  const publishAction = action(publish, "publish");
  assert.equal(publishAction.with.script, "pnpm release");
  assert.equal(publishAction.with["create-github-releases"], true);
  assert.equal(publishAction.with["push-git-tags"], true);
  assert.equal(
    publishAction.with["github-token"],
    "${{ secrets.GITHUB_TOKEN }}",
  );
  const publishInstall = publish.steps.findIndex((step) =>
    step.run?.includes("pnpm install --frozen-lockfile"),
  );
  assert.ok(
    publishInstall >= 0 &&
      publishInstall < publish.steps.indexOf(publishAction),
  );
  // Node 24 publishes; npm is pinned above the trusted-publishing minimum (11.5.1).
  assert.ok(
    publish.steps.some((step) =>
      step.run?.includes("npm install --global npm@11."),
    ),
  );

  // OIDC and the OIDC-capable steps exist only in publication.
  assert.doesNotMatch(JSON.stringify(select), /id-token/);
  assert.doesNotMatch(JSON.stringify(version), /id-token/);
  assert.equal(
    select.steps.some((step) => step.run?.includes("pnpm release")),
    false,
  );
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
  const setups = Object.values(workflow.jobs).flatMap((job) =>
    job.steps.filter(
      (step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/setup-node@"),
    ),
  );
  return (
    setups.length > 0 &&
    setups.every(
      (setup) =>
        setup.with["package-manager-cache"] === false &&
        setup.with.cache === undefined,
    )
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
