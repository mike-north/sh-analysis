/** Owner-controlled stability policy and trusted-publisher identity are independent release requirements. */

import { releaseRecord } from "./release-data.ts";

/** Only the owner can declare stability; automation has no escape hatch from the 0.x ceiling. */
export const stabilityPolicy =
  "This project stays in the 0.x series until the owner declares the shape stable; there is no override flag.";

/** Reject unknown or nonzero major versions, including prereleases of a future stable major. */
export function assertZeroVersion(
  version: unknown,
  source: unknown,
): asserts version is string {
  if (
    typeof version !== "string" ||
    !/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error(
      `${String(source)}: rejected version ${String(version)}. ${stabilityPolicy}`,
    );
  }
}

/** Publication additionally requires an explicitly chosen, non-placeholder main revision. */
export function assertRelease(
  input: unknown,
  environment: NodeJS.ProcessEnv,
): void {
  const packageJson = releaseRecord(input, "Package manifest");
  const repositoryData = releaseRecord(
    packageJson.repository,
    "Package repository",
  );
  assertZeroVersion(packageJson.version, packageJson.name);
  const repository = "mike-north/sh-analysis";
  if (
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    environment.GITHUB_REPOSITORY !== repository ||
    environment.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error(
      "Release requires manual dispatch from mike-north/sh-analysis main.",
    );
  }
  if (
    packageJson.name !== "sh-analysis" ||
    repositoryData.type !== "git" ||
    repositoryData.url !== `git+https://github.com/${repository}.git`
  ) {
    throw new Error(
      "Release package identity does not match the trusted publisher.",
    );
  }
  // Bootstrap/staging versions are deliberately not publishable; release preparation chooses a real version.
  if (
    !/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version) ||
    packageJson.version === "0.0.0" ||
    packageJson.version !== environment.RELEASE_VERSION
  ) {
    throw new Error(
      "Release requires an exact, non-placeholder stable 0.x package version.",
    );
  }
}
