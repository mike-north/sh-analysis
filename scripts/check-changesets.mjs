/** Inspect every changeset declaration, even for packages not in the current Changesets graph. */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { stabilityPolicy } from "./release-contract.mjs";

/** Major requests are forbidden even if prerelease mode or package configuration masks the bump. */
export function checkChangesets(root = process.cwd()) {
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
        const frontmatter = readFileSync(path, "utf8").match(
          /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
        );
        if (!frontmatter)
          throw new Error(`Invalid changeset ${path}. ${stabilityPolicy}`);
        const releases = parse(frontmatter[1]) ?? {};
        if (typeof releases !== "object" || Array.isArray(releases))
          throw new Error(`Invalid releases in ${path}. ${stabilityPolicy}`);
        for (const [name, bump] of Object.entries(releases)) {
          if (!["patch", "minor"].includes(bump)) {
            throw new Error(
              `${path}: ${name} requests ${String(bump)}. ${stabilityPolicy}`,
            );
          }
        }
      }
    }
  }
  visit(join(root, ".changeset"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  checkChangesets();
