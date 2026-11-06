/** Control escapes are byte operations; UTF-16 case conversion cannot establish their exact text. */
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { parseSync } from "sh-ast";
import { resolveWord } from "../../src/index.js";

/** The sole decoded argument retains raw ANSI-C contents exactly as the parser observed them. */
function resolution(escaped: string) {
  const file = parseSync(`printf %s $'${escaped}'`);
  const call = file.Stmts?.[0]?.Cmd;
  if (call?.Type !== "CallExpr" || !call.Args?.[2]) {
    throw new Error("missing control-escape argument");
  }
  return resolveWord(call.Args[2]);
}

/** Expected byte values are a finite, hand-written native-outcome contract, not a decoder formula. */
const asciiControls = [
  [String.raw`\cA`, 0x01],
  [String.raw`\cZ`, 0x1a],
  [String.raw`\ca`, 0x01],
  [String.raw`\cz`, 0x1a],
  [String.raw`\c0`, 0x10],
  [String.raw`\c1`, 0x11],
  [String.raw`\c9`, 0x19],
  [String.raw`\c!`, 0x01],
  [String.raw`\c"`, 0x02],
  [String.raw`\c~`, 0x1e],
  [String.raw`\c?`, 0x7f],
  [String.raw`\c[`, 0x1b],
  [String.raw`\c]`, 0x1d],
  [String.raw`\c^`, 0x1e],
  [String.raw`\c_`, 0x1f],
  [String.raw`\c{`, 0x1b],
  [String.raw`\c|`, 0x1c],
  [String.raw`\c}`, 0x1d],
  ["\\c\x7f", 0x1f],
] as const;

/** Only this finite fixture's printf program executes; no analyzed corpus or caller input is run. */
function bashBytes(escaped: string): number[] {
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-c", `printf %s $'${escaped}'`],
    {
      env: { ...process.env, LC_ALL: "C.UTF-8" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr.toString()).toBe("");
  return [...result.stdout];
}

it.each(asciiControls)(
  "resolves ASCII control %s to its independently specified character",
  (escaped, byte) => {
    expect(resolution(escaped)).toEqual({
      static: true,
      text: String.fromCharCode(byte),
    });
  },
);

it.each(asciiControls)(
  "Bash independently emits the specified ASCII control byte for %s",
  (escaped, byte) => {
    expect(bashBytes(escaped)).toEqual([byte]);
  },
);

/** A doubled backslash is special; other following literal characters retain their own identity. */
const consumption = [
  [String.raw`\c\\`, [0x1c]],
  [String.raw`\c\\tail`, [0x1c, 0x74, 0x61, 0x69, 0x6c]],
  [
    String.raw`prefix\c1tail`,
    [0x70, 0x72, 0x65, 0x66, 0x69, 0x78, 0x11, 0x74, 0x61, 0x69, 0x6c],
  ],
  [String.raw`\c\n`, [0x1c, 0x6e]],
  [String.raw`\c\'`, [0x1c, 0x27]],
  [String.raw`\c\"`, [0x1c, 0x22]],
  [String.raw`\c\\\n`, [0x1c, 0x0a]],
] as const;

it.each(consumption)(
  "consumes only the intended raw control operand in %s",
  (escaped, bytes) => {
    expect(bashBytes(escaped)).toEqual([...bytes]);
    expect(resolution(escaped)).toEqual({
      static: true,
      text: String.fromCharCode(...bytes),
    });
  },
);

it.each([String.raw`\c@`, "\\c`", "\\c ", String.raw`prefix\c@tail`])(
  "retains unsupported NUL-dependent control result for %s",
  (escaped) => {
    expect(resolution(escaped)).toEqual({
      static: false,
      reason: "unsupported",
    });
  },
);

it.each([
  [String.raw`\c中`, [0x04, 0xb8, 0xad]],
  [String.raw`\cß`, [0x03, 0x9f]],
  [String.raw`\c😀`, [0x10, 0x9f, 0x98, 0x80]],
] as const)(
  "declines non-ASCII control operand %s rather than fabricating Unicode text",
  (escaped, bytes) => {
    const native = bashBytes(escaped);
    expect(native).toEqual([...bytes]);
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(native)),
    ).toThrow();
    expect(resolution(escaped)).toEqual({
      static: false,
      reason: "unsupported",
    });
  },
);
