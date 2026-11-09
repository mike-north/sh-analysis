/** Inspect every changeset declaration, even for packages not in the current Changesets graph. */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { releaseRecord } from "./release-data.ts";
import { stabilityPolicy } from "./release-contract.ts";

/** Major requests are forbidden even if prerelease mode or package configuration masks the bump. */
export function checkChangesets(root = process.cwd()): void {
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
          readFileSync(path, "utf8"),
        );
        if (!frontmatter)
          throw new Error(`Invalid changeset ${path}. ${stabilityPolicy}`);
        const parsed: unknown = parse(frontmatter[1]);
        const releases = releaseRecord(parsed ?? {}, path);
        for (const [name, bump] of Object.entries(releases)) {
          if (bump !== "patch" && bump !== "minor") {
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
