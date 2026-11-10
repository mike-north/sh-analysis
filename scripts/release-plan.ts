/** Compose the public Changesets snapshot inputs without Git eligibility or consumer bump rules. */
import { assembleReleasePlan } from "@changesets/assemble-release-plan";
import { readConfig } from "@changesets/config";
import { readPreState } from "@changesets/pre";
import { readChangesets } from "@changesets/read";
import { getPackages } from "@manypkg/get-packages";

/**
 * Plan every declaration and prerelease transition in the discovered workspace.
 * Configuration validation is a result, not an exception: an absent config must
 * never reach assembly. Warnings remain visible but do not invalidate a valid
 * configuration. Discovery, reads and assembly errors propagate to the gate.
 */
export async function readReleasePlan(
  root: string,
): Promise<ReturnType<typeof assembleReleasePlan>> {
  const packages = await getPackages(root);
  const result = await readConfig(packages.rootDir, packages);
  for (const warning of result.warnings) console.warn(warning);
  if (result.errors !== undefined) {
    throw new Error(
      `Invalid Changesets configuration:\n${result.errors.join("\n")}`,
    );
  }
  // No since-ref: consumed declarations, empty plans and prerelease exits are
  // interpreted by the same assembler as CLI version preparation, not by Git.
  const [changesets, preState] = await Promise.all([
    readChangesets(packages.rootDir),
    readPreState(packages.rootDir),
  ]);
  return assembleReleasePlan(changesets, packages, result.config, preState);
}
