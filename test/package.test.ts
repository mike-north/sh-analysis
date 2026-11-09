/** A real tarball install exercises published boundaries in a fresh package and cold process. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { object, objects } from "./support.ts";

/** Execute package-manager commands without shell interpolation or lifecycle scripts. */
function command(
  program: string,
  args: readonly string[],
  cwd: string,
): string {
  const result = spawnSync(program, args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${program} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

/** Return the packed path without depending on a generated name or snapshot. */
function pack(directory: string, destination: string): string {
  const [result] = objects(
    JSON.parse(
      command(
        "npm",
        [
          "pack",
          directory,
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          destination,
        ],
        process.cwd(),
      ),
    ),
  );
  assert.ok(typeof result.filename === "string");
  return join(destination, result.filename);
}

void test("installed package resolves only its declared public dependency and cold synchronous API", () => {
  const temporary = mkdtempSync(join(tmpdir(), "sh-analysis-package-"));
  try {
    const analysis = pack(process.cwd(), temporary);
    const bindingDirectory = dirname(
      dirname(fileURLToPath(import.meta.resolve("sh-ast"))),
    );
    const binding = pack(bindingDirectory, temporary);
    const bindingMetadata = object(
      JSON.parse(readFileSync(join(bindingDirectory, "package.json"), "utf8")),
    );
    const metadata = object(JSON.parse(readFileSync("package.json", "utf8")));
    assert.equal(object(metadata.dependencies)["sh-ast"], "^0.11.0");
    assert.ok(typeof bindingMetadata.version === "string");
    assert.match(
      bindingMetadata.version,
      /^0\.11\.\d+$/,
      "Smoke binding must satisfy the actual supported release line",
    );
    writeFileSync(
      join(temporary, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          "sh-analysis": `file:${analysis}`,
          "sh-ast": `file:${binding}`,
        },
      }),
    );
    command(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
      ],
      temporary,
    );
    cpSync(
      new URL("./fixtures/package-smoke.ts", import.meta.url),
      join(temporary, "smoke.ts"),
    );
    command(
      process.execPath,
      ["--experimental-strip-types", "smoke.ts"],
      temporary,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
