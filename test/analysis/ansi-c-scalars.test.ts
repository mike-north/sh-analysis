/** ANSI-C Unicode escapes claim text only for Unicode scalar values, independent of UTF-16 storage. */
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { parseSync } from "sh-ast";
import { resolveWord } from "../../src/index.js";

/** Extract one literal argument without deriving any expected output from the analyzer. */
function resolution(escaped: string) {
  const file = parseSync(`printf %s $'${escaped}'`);
  const call = file.Stmts?.[0]?.Cmd;
  if (call?.Type !== "CallExpr" || !call.Args?.[2])
    throw new Error("missing ANSI-C argument");
  return resolveWord(call.Args[2]);
}

it.each([
  String.raw`\uD800`,
  String.raw`\uDBFF`,
  String.raw`\uDC00`,
  String.raw`\uDFFF`,
  String.raw`\U0000D800`,
  String.raw`\U0000DFFF`,
])("does not claim exact Unicode text for surrogate escape %s", (escaped) => {
  expect(resolution(escaped)).toEqual({ static: false, reason: "unsupported" });
});

it("does not combine two separately encoded surrogate escapes into one scalar", () => {
  expect(resolution(String.raw`\uD83D\uDE00`)).toEqual({
    static: false,
    reason: "unsupported",
  });
});

it.each([
  [String.raw`\uD7FF`, "\uD7FF"],
  [String.raw`\uE000`, "\uE000"],
  [String.raw`\U0001F600`, "😀"],
])("retains valid scalar control %s", (escaped, text) => {
  expect(resolution(escaped)).toEqual({ static: true, text });
});

it.each([
  [String.raw`\uD800`, [0xed, 0xa0, 0x80], false],
  [String.raw`\uDFFF`, [0xed, 0xbf, 0xbf], false],
  [String.raw`\uD83D\uDE00`, [0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80], false],
  [String.raw`\U0001F600`, [0xf0, 0x9f, 0x98, 0x80], true],
] as const)(
  "Bash independently emits the hand-derived bytes for %s",
  (escaped, expected, unicodeText) => {
    // Only these fixed printf programs execute; no analyzed source or caller data is run.
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-c", `printf %s $'${escaped}'`],
      { env: { ...process.env, LC_ALL: "C.UTF-8" } },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect([...result.stdout]).toEqual([...expected]);
    if (unicodeText) {
      expect(
        new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
      ).toBe("😀");
    } else {
      expect(() =>
        new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
      ).toThrow();
    }
  },
);
