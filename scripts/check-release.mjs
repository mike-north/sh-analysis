/** Validate the on-disk package identity; callers cannot supply alternate package metadata. */
import { readFileSync } from "node:fs";
import { assertRelease } from "./release-contract.mjs";
assertRelease(
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")),
  process.env,
);
