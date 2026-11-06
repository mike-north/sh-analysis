/** Only known host stack exhaustion at the copy boundary becomes an analysis resource refusal. */
import { afterEach, expect, it, vi } from "vitest";
import { parseSync, ShInternalError, ShAstError, splitBraces } from "sh-ast";
import type { Word } from "sh-ast";
import {
  resolveWord,
  ShAnalysisError,
  ShAnalyzeMaxDepthError,
  ShAnalyzeResourceError,
} from "../../src/index.js";
import { deepCopyWord } from "./brace-copy-fixture.js";

vi.mock("sh-ast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sh-ast")>();
  return { ...actual, splitBraces: vi.fn(actual.splitBraces) };
});
const actualSyntax = await vi.importActual<typeof import("sh-ast")>("sh-ast");

/** Restore both the native copy function and the forwarding public binding observation. */
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(splitBraces).mockImplementation(actualSyntax.splitBraces);
  vi.mocked(splitBraces).mockClear();
});

/** A shallow genuine brace Word reaches the copy operation without unrelated analysis. */
function candidate(): Word {
  const command = parseSync("echo {a,b}").Stmts?.[0]?.Cmd;
  if (command?.Type !== "CallExpr" || !command.Args?.[1]) {
    throw new Error("missing brace argument");
  }
  return command.Args[1];
}

/** Capture thrown identity without interpreting text or accepting a successful return. */
function thrown(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("fixture unexpectedly completed");
}

it("adapts only the observed native stack refusal, retaining its cause and owning operation", () => {
  const word = candidate();
  const failure = new RangeError("Maximum call stack size exceeded");
  vi.spyOn(globalThis, "structuredClone").mockImplementation(() => {
    throw failure;
  });
  const error = thrown(() => resolveWord(word));
  expect(error).toBeInstanceOf(ShAnalysisError);
  expect(error).toBeInstanceOf(ShAnalyzeResourceError);
  expect(error).not.toBeInstanceOf(ShAstError);
  expect(error).not.toBeInstanceOf(ShAnalyzeMaxDepthError);
  expect(error).toMatchObject({
    name: "ShAnalyzeResourceError",
    code: "SH_ANALYSIS_RESOURCE",
    operation: "brace-observation-copy",
  });
  if (!(error instanceof ShAnalyzeResourceError)) {
    throw new Error("missing typed resource failure");
  }
  expect(error.cause).toBe(failure);
  expect(Object.getOwnPropertyDescriptor(error, "cause")?.enumerable).toBe(
    false,
  );
  expect(splitBraces).not.toHaveBeenCalled();
});

it.each([
  new RangeError("Invalid array length"),
  new RangeError("Maximum call stack size exceeded elsewhere"),
  new Error("Maximum call stack size exceeded"),
  new DOMException("not cloneable", "DataCloneError"),
  { name: "RangeError", message: "Maximum call stack size exceeded" },
])("preserves unrelated copy failure identity: %s", (failure) => {
  const word = candidate();
  vi.spyOn(globalThis, "structuredClone").mockImplementation(() => {
    throw failure;
  });
  expect(thrown(() => resolveWord(word))).toBe(failure);
  expect(splitBraces).not.toHaveBeenCalled();
});

it("does not relabel the same error text thrown after copying by the binding", () => {
  const word = candidate();
  const failure = new RangeError("Maximum call stack size exceeded");
  vi.mocked(splitBraces).mockImplementation(() => {
    throw failure;
  });
  expect(thrown(() => resolveWord(word))).toBe(failure);
});

it("retains native clone isolation and aliases during ordinary successful observation", () => {
  const word = candidate();
  const shared = parseSync("echo tail").Stmts?.[0]?.Cmd;
  if (
    shared?.Type !== "CallExpr" ||
    !shared.Args?.[1]?.Parts?.[0] ||
    !word.Parts
  ) {
    throw new Error("missing alias fixture");
  }
  const literal = shared.Args[1].Parts[0];
  word.Parts.push(literal, literal);
  const parts = word.Parts;
  const before = structuredClone(word);
  vi.mocked(splitBraces).mockImplementation((observed) => {
    expect(observed).not.toBe(word);
    expect(observed.Parts).not.toBe(parts);
    expect(observed.Parts?.[1]).toBe(observed.Parts?.[2]);
    expect(observed.Parts?.[1]).not.toBe(literal);
    return actualSyntax.splitBraces(observed);
  });
  expect(resolveWord(word)).toEqual({ static: false, reason: "brace" });
  expect(word).toEqual(before);
  expect(word.Parts).toBe(parts);
  expect(word.Parts[1]).toBe(literal);
  expect(word.Parts[2]).toBe(literal);
});

it("constructs the deep fixture with public types and reaches the binding's distinct input refusal", () => {
  const failure = thrown(() => actualSyntax.splitBraces(deepCopyWord()));
  expect(failure).toBeInstanceOf(ShInternalError);
  expect(failure).toMatchObject({
    message:
      "SplitBraces input record depth 257 exceeds the bridge transport limit 256",
  });
});
