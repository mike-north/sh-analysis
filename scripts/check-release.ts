/** Check all on-disk and planned versions before authorizing the trusted-publisher identity. */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readReleasePlan } from "./release-plan.ts";
import {
  assertRelease,
  assertZeroVersion,
  stabilityPolicy,
} from "./release-contract.ts";
import { releaseRecord } from "./release-data.ts";
import { checkChangesets } from "./check-changesets.ts";

/** Discover source manifests independently of workspace/ignore configuration so none can hide a 1.x version. */
export async function checkVersions(root = process.cwd()): Promise<void> {
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
  // Plan the complete working snapshot, even when it contains no pending declarations.
  // The adapter composes the public APIs used by the pinned CLI's preparation,
  // without Git-diff/missing-changeset eligibility policy. Prerelease exit and dependent bumps
  // remain planner responsibilities; neither absent history nor an empty plan is an error.
  let plan: Awaited<ReturnType<typeof readReleasePlan>>;
  try {
    plan = await readReleasePlan(root);
  } catch (cause) {
    throw new Error(
      `Cannot compute Changesets release plan. ${stabilityPolicy}`,
      { cause },
    );
  }
  for (const release of plan.releases) {
    assertZeroVersion(
      release.newVersion,
      `Changesets next version for ${release.name}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  checkChangesets(root);
  await checkVersions(root);
  assertRelease(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    process.env,
  );
}
