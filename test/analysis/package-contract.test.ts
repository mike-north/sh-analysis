/** Package contracts keep interpretation independent from parser failures and private transports. */
import { describe, expect, it } from "vitest";
import { ShAstError, parseSync } from "sh-ast";
import {
  ShAnalysisError,
  ShAnalyzeMaxDepthError,
  ShAnalyzeInvalidWrapperSpecError,
  enumerateCommands,
  resolveWord,
} from "../../src/index.js";

describe("independent analysis package", () => {
  it("owns refusal errors independently of binding errors", () => {
    for (const error of [
      new ShAnalyzeMaxDepthError(500),
      new ShAnalyzeInvalidWrapperSpecError("names required"),
    ]) {
      expect(error).toBeInstanceOf(ShAnalysisError);
      expect(error).not.toBeInstanceOf(ShAstError);
      expect(error.code).toMatch(/^SH_ANALYSIS_/);
    }
  });
  it("retains caller node identity and resolves multibyte static words without changing syntax", () => {
    const file = parseSync('echo "🎉中é"');
    const before = structuredClone(file);
    const [site] = enumerateCommands(file).commands;
    expect(site.node).toBe(file.Stmts?.[0]?.Cmd);
    expect(site.argv[1]).toEqual({ static: true, text: "🎉中é" });
    expect(file).toEqual(before);
  });
  it("ordinary unknown expansion is a value rather than a thrown error", () => {
    const file = parseSync('echo "$HOME"');
    const command = file.Stmts?.[0]?.Cmd;
    if (command?.Type !== "CallExpr" || !command.Args?.[1])
      throw new Error("missing argument");
    expect(resolveWord(command.Args[1])).toEqual({
      static: false,
      reason: "expansion",
    });
  });
});

it("supports structured-clone inputs without sharing retained command identities", () => {
  const original = parseSync("echo '🎉 你好 e\\u0301'\n");
  const copy = structuredClone(original);
  const inventory = enumerateCommands(copy);
  expect(inventory.uncertainties).toEqual([]);
  expect(inventory.commands).toHaveLength(1);
  const [site] = inventory.commands;
  expect(site.node).toBe(copy.Stmts?.[0]?.Cmd);
  expect(site.node).not.toBe(original.Stmts?.[0]?.Cmd);
  expect(site.argv).toEqual([
    { static: true, text: "echo" },
    { static: true, text: "🎉 你好 e\\u0301" },
  ]);
  const operand = site.node.Args?.[1];
  if (!operand) throw new Error("missing cloned operand");
  expect(resolveWord(operand)).toEqual({
    static: true,
    text: "🎉 你好 e\\u0301",
  });
});
