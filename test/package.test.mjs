/** A real tarball install exercises published boundaries in a fresh package and cold process. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** Execute package-manager commands without shell interpolation or lifecycle scripts. */
function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${program} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

/** Return the packed path without depending on a generated name or snapshot. */
function pack(directory, destination) {
  const [result] = JSON.parse(
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
  );
  return join(destination, result.filename);
}

test("installed package resolves only its declared public dependency and cold synchronous API", () => {
  const temporary = mkdtempSync(join(tmpdir(), "sh-analysis-package-"));
  try {
    const analysis = pack(process.cwd(), temporary);
    const bindingDirectory = dirname(
      dirname(fileURLToPath(import.meta.resolve("sh-ast"))),
    );
    const binding = pack(bindingDirectory, temporary);
    const bindingMetadata = JSON.parse(
      readFileSync(join(bindingDirectory, "package.json"), "utf8"),
    );
    const metadata = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(metadata.dependencies?.["sh-ast"], "^0.11.0");
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
    writeFileSync(
      join(temporary, "smoke.mjs"),
      `
      import assert from 'node:assert/strict';
      import { parseSync, LangZsh } from 'sh-ast';
      import { enumerateCommands, resolveArgv0, resolveWord, ShAnalysisError, ShAnalyzeMaxDepthError, ShAnalyzeResourceError } from 'sh-analysis';
      const file = parseSync('env A=1 printf "🎉中"');
      const inventory = enumerateCommands(file);
      assert.deepEqual(inventory.uncertainties, []);
      assert.equal(inventory.commands[0].node, file.Stmts[0].Cmd);
      assert.deepEqual(resolveArgv0(inventory.commands[0]).effective, { static: true, text: 'printf' });
      assert.deepEqual(resolveWord(parseSync('echo {a,b}').Stmts[0].Cmd.Args[1]), { static: false, reason: 'brace' });
      const opaque = enumerateCommands(parseSync('echo "\u0024{a[(r)\u0024(printf foo)]}"', { Variant: LangZsh }));
      assert.equal(opaque.commands.length, 1);
      assert.equal(opaque.uncertainties[0].reason, 'opaque-zsh-subscript');
      assert.ok(new ShAnalyzeMaxDepthError(500) instanceof ShAnalysisError);
      const copyCause = new RangeError('Maximum call stack size exceeded');
      const copyRefusal = new ShAnalyzeResourceError('brace-observation-copy', copyCause);
      assert.ok(copyRefusal instanceof ShAnalysisError);
      assert.equal(copyRefusal.code, 'SH_ANALYSIS_RESOURCE');
      assert.equal(copyRefusal.operation, 'brace-observation-copy');
      assert.equal(copyRefusal.cause, copyCause);
      for (const specifier of ['sh-analysis/analyze', 'sh-analysis/dist/brace-observation.js']) {
        await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
      }
      assert.ok(import.meta.resolve('sh-analysis').includes('/node_modules/sh-analysis/'));
      assert.ok(import.meta.resolve('sh-ast').includes('/node_modules/sh-ast/'));
    `,
    );
    command(process.execPath, ["smoke.mjs"], temporary);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
