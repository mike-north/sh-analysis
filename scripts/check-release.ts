/** Check all on-disk and planned versions before authorizing the trusted-publisher identity. */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertRelease,
  assertZeroVersion,
  stabilityPolicy,
} from "./release-contract.ts";
import { isReleaseList, releaseRecord } from "./release-data.ts";
import { checkChangesets } from "./check-changesets.ts";

/** Discover source manifests independently of workspace/ignore configuration so none can hide a 1.x version. */
export function checkVersions(root = process.cwd()): void {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      // Installed dependencies and Git metadata are outside this repository's publication scope.
      if (entry.isDirectory() && !["node_modules", ".git"].includes(entry.name))
        visit(path);
      else if (entry.isFile() && entry.name === "package.json") {
        const manifest = releaseRecord(
          JSON.parse(readFileSync(path, "utf8")),
          path,
        );
        if (manifest.private !== true)
          assertZeroVersion(manifest.version, path);
      }
    }
  }
  visit(root);
  const changesets = join(root, ".changeset");
  const pending = readdirSync(changesets, {
    recursive: true,
    encoding: "utf8",
  }).some((path) => path.endsWith(".md") && basename(path) !== "README.md");
  // Without pending changesets or prerelease state, versioning has no next versions.
  // Status also enforces missing-changeset policy, which is outside this ceiling's responsibility.
  if (!pending && !existsSync(join(changesets, "pre.json"))) return;
  // Use the pinned CLI's full plan, including dependent bumps and prerelease configuration.
  // Temporary output stays inside the checked worktree and is removed even on failure.
  const temporary = mkdtempSync(join(root, ".release-plan-"));
  try {
    const output = join(temporary, "plan.json");
    const cli = fileURLToPath(import.meta.resolve("@changesets/cli/bin.js"));
    const result = spawnSync(
      process.execPath,
      [cli, "status", "--output", relative(root, output)],
      { cwd: root, encoding: "utf8" },
    );
    if (result.status !== 0)
      throw new Error(
        `Cannot compute Changesets release plan: ${result.stderr || result.stdout}. ${stabilityPolicy}`,
      );
    const plan = releaseRecord(
      JSON.parse(readFileSync(output, "utf8")),
      "Changesets plan",
    );
    if (!isReleaseList(plan.releases))
      throw new Error(`Invalid Changesets release plan. ${stabilityPolicy}`);
    for (const entry of plan.releases) {
      const release = releaseRecord(entry, "Changesets release");
      assertZeroVersion(
        release.newVersion,
        `Changesets next version for ${String(release.name)}`,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  checkChangesets(root);
  checkVersions(root);
  assertRelease(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    process.env,
  );
}
