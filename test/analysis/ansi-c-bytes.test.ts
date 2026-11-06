/** Shell byte escapes are not Latin-1 Unicode text, and NUL terminates Bash word storage. */
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { parseSync } from "sh-ast";
import { resolveWord } from "../../src/index.js";

/** The fixture is an argument, so only ANSI-C text interpretation determines the outcome. */
function resolution(escaped: string) {
  const file = parseSync(`printf %s $'${escaped}'`);
  const call = file.Stmts?.[0]?.Cmd;
  if (call?.Type !== "CallExpr" || !call.Args?.[2])
    throw new Error("missing byte-escape argument");
  return resolveWord(call.Args[2]);
}

it.each([
  String.raw`\xFF`,
  String.raw`\377`,
  String.raw`\400`,
  String.raw`\777`,
  String.raw`\x80`,
  String.raw`\200`,
  String.raw`\303\251`,
  String.raw`\xC3\xA9`,
  String.raw`\0`,
  String.raw`\000`,
  String.raw`\x00`,
  String.raw`prefix\0suffix`,
  String.raw`prefix\x00suffix`,
  String.raw`\c@`,
  String.raw`\u0000`,
  String.raw`\U00000000`,
])("declines byte-oriented or NUL-dependent text %s", (escaped) => {
  expect(resolution(escaped)).toEqual({ static: false, reason: "unsupported" });
});

it.each([
  [String.raw`\x41`, "A"],
  [String.raw`\101`, "A"],
  [String.raw`\401`, "\x01"],
  [String.raw`\177`, "\x7f"],
  [String.raw`\cA`, "\x01"],
  [String.raw`\n\t`, "\n\t"],
  [String.raw`\u00E9`, "é"],
  [String.raw`\U0001F600`, "😀"],
])(
  "retains supported ASCII bytes and non-NUL scalar text %s",
  (escaped, text) => {
    expect(resolution(escaped)).toEqual({ static: true, text });
  },
);

it.each([
  [String.raw`\xFF`, [0xff]],
  [String.raw`\377`, [0xff]],
  [String.raw`\400`, []],
  [String.raw`\401`, [0x01]],
  [String.raw`\777`, [0xff]],
  [String.raw`\0`, []],
  [String.raw`\x00`, []],
  [String.raw`prefix\0suffix`, [0x70, 0x72, 0x65, 0x66, 0x69, 0x78]],
  [String.raw`prefix\x00suffix`, [0x70, 0x72, 0x65, 0x66, 0x69, 0x78]],
  [String.raw`\c@`, []],
  [String.raw`\x41`, [0x41]],
  [String.raw`\101`, [0x41]],
  [String.raw`\303\251`, [0xc3, 0xa9]],
] as const)(
  "Bash byte oracle independently demonstrates %s",
  (escaped, expected) => {
    // This finite hand-authored fixture table is the only source executed.
    const result = spawnSync(
      "bash",
      ["--noprofile", "--norc", "-c", `printf %s $'${escaped}'`],
      { env: { ...process.env, LC_ALL: "C.UTF-8" } },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect([...result.stdout]).toEqual([...expected]);
  },
);
