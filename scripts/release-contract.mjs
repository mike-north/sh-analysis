/** Publication is permitted only for an explicitly chosen, non-placeholder 0.x main revision. */
export function assertRelease(packageJson, environment) {
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
    packageJson.repository?.type !== "git" ||
    packageJson.repository?.url !== `git+https://github.com/${repository}.git`
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
