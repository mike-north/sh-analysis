/** A cold installed consumer asserts public analysis outcomes and refuses private package paths. */
import assert from "node:assert/strict";
import { parseSync, LangZsh } from "sh-ast";
import {
  enumerateCommands,
  resolveArgv0,
  resolveWord,
  ShAnalysisError,
  ShAnalyzeMaxDepthError,
  ShAnalyzeResourceError,
} from "sh-analysis";
const file = parseSync('env A=1 printf "🎉中"');
const inventory = enumerateCommands(file);
assert.deepEqual(inventory.uncertainties, []);
assert.equal(inventory.commands[0].node, file.Stmts?.[0]?.Cmd);
assert.deepEqual(resolveArgv0(inventory.commands[0]).effective, {
  static: true,
  text: "printf",
});
const braces = parseSync("echo {a,b}").Stmts?.[0]?.Cmd;
assert.ok(braces?.Type === "CallExpr" && braces.Args?.[1]);
assert.deepEqual(resolveWord(braces.Args[1]), {
  static: false,
  reason: "brace",
});
const opaque = enumerateCommands(
  parseSync('echo "${a[(r)$(printf foo)]}"', { Variant: LangZsh }),
);
assert.equal(opaque.commands.length, 1);
assert.equal(opaque.uncertainties[0].reason, "opaque-zsh-subscript");
assert.ok(new ShAnalyzeMaxDepthError(500) instanceof ShAnalysisError);
const copyCause = new RangeError("Maximum call stack size exceeded");
const copyRefusal = new ShAnalyzeResourceError(
  "brace-observation-copy",
  copyCause,
);
assert.ok(copyRefusal instanceof ShAnalysisError);
assert.equal(copyRefusal.code, "SH_ANALYSIS_RESOURCE");
assert.equal(copyRefusal.operation, "brace-observation-copy");
assert.equal(copyRefusal.cause, copyCause);
for (const specifier of [
  "sh-analysis/analyze",
  "sh-analysis/dist/brace-observation.js",
]) {
  await assert.rejects(import(specifier), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
}
assert.ok(
  import.meta.resolve("sh-analysis").includes("/node_modules/sh-analysis/"),
);
assert.ok(import.meta.resolve("sh-ast").includes("/node_modules/sh-ast/"));
