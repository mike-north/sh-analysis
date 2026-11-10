/** Owner-controlled stability policy and trusted-publisher identity are independent release requirements. */

import { parse } from "semver";
import { releaseRecord } from "./release-data.ts";

/** Only the owner can declare stability; automation has no escape hatch from the 0.x ceiling. */
export const stabilityPolicy =
  "This project stays in the 0.x series until the owner declares the shape stable; there is no override flag.";

/** Reject unknown or nonzero major versions, including prereleases of a future stable major. */
export function assertZeroVersion(
  version: unknown,
  source: unknown,
): asserts version is string {
  // npm's strict parser still accepts a leading v and trims whitespace. Package
  // versions here must use exact unprefixed SemVer spelling; build identifiers are
  // valid metadata and must not be lost by comparing the parser's normalized version.
  const parsed =
    typeof version === "string" &&
    version === version.trim() &&
    /^[0-9]/.test(version)
      ? parse(version)
      : null;
  if (parsed?.major !== 0) {
    throw new Error(
      `${String(source)}: rejected version ${String(version)}. ${stabilityPolicy}`,
    );
  }
}

/**
 * Publication requires a push to main of the trusted repository, the registered package identity
 * and a real (non-placeholder) 0.x version. Which version ships is decided by the Version Packages
 * pull request that was merged, not by a typed input.
 */
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
    environment.GITHUB_EVENT_NAME !== "push" ||
    environment.GITHUB_REPOSITORY !== repository ||
    environment.GITHUB_REF !== "refs/heads/main"
  ) {
    throw new Error("Release requires a push to mike-north/sh-analysis main.");
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
  // Bootstrap/staging versions are deliberately not publishable; Changesets chooses a real version.
  if (
    !/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version) ||
    packageJson.version === "0.0.0"
  ) {
    throw new Error(
      "Release requires an exact, non-placeholder 0.x package version.",
    );
  }
}
