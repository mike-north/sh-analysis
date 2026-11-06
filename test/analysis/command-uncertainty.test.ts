/** Opaque syntax is a completeness limit regardless of whether raw text resembles a command. */
import { expect, it } from "vitest";
import { LangZsh, parseSync } from "sh-ast";
import { enumerateCommands } from "../../src/index.js";
import { syntheticNode } from "./analyze-fixtures.js";

it("reports upstream raw Zsh subscript uncertainty without inventing a nested command", () => {
  const file = parseSync('echo "${a[(r)$(printf foo)]}"', { Variant: LangZsh });
  const inventory = enumerateCommands(file);
  expect(inventory.commands.map((site) => site.argv0)).toEqual([
    { static: true, text: "echo" },
  ]);
  expect(inventory.uncertainties).toHaveLength(1);
  expect(inventory.uncertainties[0]).toMatchObject({
    reason: "opaque-zsh-subscript",
    node: { Type: "FlagsArithm" },
    context: [],
  });
});

it("retains the exact opaque node and the surrounding command context", () => {
  const literal = syntheticNode("Lit", { Value: "$(nested)" });
  const opaque = syntheticNode("FlagsArithm", {
    X: syntheticNode("Word", { Parts: [literal] }),
  });
  const root = syntheticNode("Subshell", {
    Stmts: [
      syntheticNode("Stmt", { Cmd: syntheticNode("ArithmCmd", { X: opaque }) }),
    ],
  });
  const inventory = enumerateCommands(root);
  expect(inventory.commands).toEqual([]);
  expect(inventory.uncertainties).toEqual([
    {
      reason: "opaque-zsh-subscript",
      node: opaque,
      context: [{ kind: "subshell" }],
    },
  ]);
  expect(inventory.uncertainties[0].node).toBe(opaque);
});

it.each(["foo", "$(nested)", new Uint8Array([0xff])])(
  "does not infer completeness from opaque text %j",
  (Value) => {
    const opaque = syntheticNode("FlagsArithm", {
      X: syntheticNode("Word", { Parts: [syntheticNode("Lit", { Value })] }),
    });
    expect(enumerateCommands(opaque).uncertainties).toEqual([
      { reason: "opaque-zsh-subscript", node: opaque, context: [] },
    ]);
  },
);

it("ordinary literal and single-quoted raw-looking text do not create opaque-syntax uncertainty", () => {
  const inventory = enumerateCommands(
    parseSync("echo '${a[(r)$(nested)]}' ordinary", { Variant: LangZsh }),
  );
  expect(inventory.commands).toHaveLength(1);
  expect(inventory.uncertainties).toEqual([]);
});

it("an empty opaque subscript argument has no unrepresented contents", () => {
  expect(enumerateCommands(syntheticNode("FlagsArithm")).uncertainties).toEqual(
    [],
  );
});

it("explicit represented expansion children remain enumerable without opaque-text uncertainty", () => {
  const call = syntheticNode("CallExpr", {
    Args: [
      syntheticNode("Word", {
        Parts: [syntheticNode("Lit", { Value: "nested" })],
      }),
    ],
  });
  const substitution = syntheticNode("CmdSubst", {
    Stmts: [syntheticNode("Stmt", { Cmd: call })],
  });
  const flags = syntheticNode("FlagsArithm", {
    X: syntheticNode("Word", { Parts: [substitution] }),
  });
  const inventory = enumerateCommands(flags);
  expect(inventory.commands.map((site) => site.argv0)).toEqual([
    { static: true, text: "nested" },
  ]);
  expect(inventory.uncertainties).toEqual([]);
});

it("an explicit arithmetic expression is not the upstream opaque-pattern representation", () => {
  const term = syntheticNode("Word", {
    Parts: [syntheticNode("Lit", { Value: "1" })],
  });
  const flags = syntheticNode("FlagsArithm", {
    X: syntheticNode("BinaryArithm", { X: term, Y: term }),
  });
  expect(enumerateCommands(flags).uncertainties).toEqual([]);
});
