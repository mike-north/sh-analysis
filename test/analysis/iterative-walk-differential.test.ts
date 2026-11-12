/**
 * The iterative `enumerateCommands` must return exactly what the recursive formulation it
 * replaced returned: the same sites and uncertainties, in the same order, with the same
 * contexts, and the same typed failure at the same inputs. The recursive reference lives in
 * `reference/recursive-enumerate-commands.ts` and is never exported by the package.
 *
 * Inputs: every source text the analysis suites feed the parser (`fixtures/differential-corpus.json`,
 * with its dialect), the same text parsed as separate top-level statements, long-but-parseable
 * chains of each kind (the recursive reference can still handle these), and hand-built trees at the
 * nesting-limit boundary.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSync } from "sh-ast";
import type { ArithmExpr, Node } from "sh-ast";
import { enumerateCommands } from "../../src/index.js";
import { referenceEnumerateCommands } from "./reference/recursive-enumerate-commands.js";
import { syntheticNode } from "./analyze-fixtures.js";

/** One source text with the dialect it was parsed under; `null` is the parser default. */
interface CorpusEntry {
  readonly src: string;
  readonly variant: number | null;
}

/** Narrow parsed JSON to the corpus shape before use. */
function isCorpus(value: unknown): value is CorpusEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "src" in entry &&
        typeof entry.src === "string" &&
        "variant" in entry &&
        (entry.variant === null || typeof entry.variant === "number"),
    )
  );
}

const corpus: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/differential-corpus.json", import.meta.url),
    ),
    "utf8",
  ),
);
if (!isCorpus(corpus)) throw new Error("malformed differential corpus");

/** A result, or the identity of what was thrown, so failures are compared too. */
function observe(run: (root: Node) => unknown, root: Node): unknown {
  try {
    return { result: run(root) };
  } catch (error) {
    return {
      thrown:
        error instanceof Error
          ? { name: error.constructor.name, message: error.message }
          : String(error),
    };
  }
}

/** Old and new agree on `root`, including order and failure. Returns the shared observation. */
function expectSameOutcome(root: Node): unknown {
  const expected = observe(referenceEnumerateCommands, root);
  expect(observe(enumerateCommands, root)).toEqual(expected);
  return expected;
}

describe("iterative enumerateCommands matches the recursive reference", () => {
  it("over every source text the analysis suites parse", () => {
    let compared = 0;
    let withSites = 0;
    for (const { src, variant } of corpus) {
      let file;
      try {
        file = parseSync(
          src,
          variant === null ? undefined : { Variant: variant },
        );
      } catch {
        continue; // Inputs the parser rejects are negative tests; there is no tree to compare.
      }
      expectSameOutcome(file);
      compared += 1;
      for (const stmt of file.Stmts ?? []) {
        if (stmt) expectSameOutcome(stmt);
      }
      const shared = observe(enumerateCommands, file);
      if (
        typeof shared === "object" &&
        shared !== null &&
        "result" in shared &&
        typeof shared.result === "object" &&
        shared.result !== null &&
        "commands" in shared.result &&
        Array.isArray(shared.result.commands) &&
        shared.result.commands.length > 0
      ) {
        withSites += 1;
      }
    }
    // Guard against the corpus silently shrinking into a vacuous comparison.
    expect(compared).toBeGreaterThan(450);
    expect(withSites).toBeGreaterThan(350);
  });

  /** Stand-ins for chains the parser accepts today at a length the reference can still recurse over. */
  const links = 100;
  const plus = Array.from({ length: links }, () => "1").join(" + ");
  const hidden = (op: string) =>
    `$(first) ${op} ${Array.from({ length: links }, () => "1").join(` ${op} `)} ${op} $(last)`;
  it.each([
    ["arithmetic expansion", `echo $(( ${hidden("+")} ))`],
    ["arithmetic command", `(( ${hidden("+")} ))`],
    ["let", `let "${hidden("+")}"`],
    ["array subscript", `a[${hidden("+")}]=v`],
    ["parameter slice", `echo \${x:${hidden("+")}}`],
    [
      "test ||",
      `[[ -n $(first) ${Array.from({ length: links }, () => "|| -n b").join(" ")} || -n $(last) ]]`,
    ],
    ["&&", `${Array.from({ length: links }, () => "a").join(" && ")} && $(x)`],
    ["pipeline", Array.from({ length: links }, () => "a").join(" | ")],
    ["plain sum", `echo $(( ${plus} ))`],
  ])("over a %s chain", (_name, source) => {
    const outcome = expectSameOutcome(parseSync(source));
    expect(outcome).toHaveProperty("result");
  });

  it("over a long elif chain with statements, including where it trips the nesting limit", () => {
    for (const count of [1, 40, 120]) {
      const source = `if a; then b; ${Array.from({ length: count }, () => "elif c; then d;").join(" ")} fi`;
      let file;
      try {
        file = parseSync(source);
      } catch {
        continue;
      }
      expectSameOutcome(file);
    }
  });

  /** An `if` whose `elif` chain has `length` clauses, each holding one command, built without the parser. */
  function elifChain(length: number): Node {
    const stmt = () =>
      syntheticNode("Stmt", {
        Cmd: syntheticNode("CallExpr", {
          Args: [
            syntheticNode("Word", {
              Parts: [syntheticNode("Lit", { Value: "x" })],
            }),
          ],
        }),
      });
    let clause = syntheticNode("IfClause", { Cond: [stmt()], Then: [stmt()] });
    for (let link = 1; link < length; link++) {
      clause = syntheticNode("IfClause", {
        Cond: [stmt()],
        Then: [stmt()],
        Else: clause,
      });
    }
    return syntheticNode("File", {
      Stmts: [syntheticNode("Stmt", { Cmd: clause })],
    });
  }

  /** A word naming `text` as a plain literal. */
  const literal = (text: string) =>
    syntheticNode("Word", { Parts: [syntheticNode("Lit", { Value: text })] });
  /** `$(name)`: a command whose position is the zero position every hand-built node shares. */
  const substitution = (name: string) =>
    syntheticNode("Word", {
      Parts: [
        syntheticNode("CmdSubst", {
          Stmts: [
            syntheticNode("Stmt", {
              Cmd: syntheticNode("CallExpr", { Args: [literal(name)] }),
            }),
          ],
        }),
      ],
    });
  /** A raw Zsh subscript pattern: an opaque construct, distinguishable by its text. */
  const opaque = (text: string) =>
    syntheticNode("FlagsArithm", { X: literal(text) });

  it("keeps discovery order for findings that share a source position", () => {
    // Every hand-built node sits at offset 0, so sites tie on position and only the order in
    // which the walk meets them separates them; uncertainties are never sorted at all.
    let spine: ArithmExpr = substitution("c0");
    const leaves = ["c1", "c2", "c3", "c4"];
    for (const name of leaves) {
      spine = syntheticNode("BinaryArithm", {
        X: spine,
        Y: substitution(name),
      });
    }
    const flagged = syntheticNode("BinaryArithm", {
      X: syntheticNode("BinaryArithm", { X: opaque("u0"), Y: opaque("u1") }),
      Y: syntheticNode("BinaryArithm", { X: opaque("u2"), Y: opaque("u3") }),
    });
    const root = syntheticNode("Subshell", {
      Stmts: [
        syntheticNode("Stmt", {
          Cmd: syntheticNode("ArithmCmd", { X: spine }),
        }),
        syntheticNode("Stmt", {
          Cmd: syntheticNode("ArithmCmd", { X: flagged }),
        }),
        syntheticNode("Stmt", {
          Cmd: syntheticNode("CallExpr", {
            Args: [literal("echo"), substitution("a0"), substitution("a1")],
          }),
        }),
      ],
    });
    expectSameOutcome(root);
    // Left to right through the tree: the arithmetic substitutions, then the arguments' own, and
    // only then the invocation they belong to (its words are scanned before it is recorded).
    const inventory = enumerateCommands(root);
    expect(
      inventory.commands.map((site) => site.argv0).map((word) => word),
    ).toEqual(
      ["c0", "c1", "c2", "c3", "c4", "a0", "a1", "echo"].map((text) => ({
        static: true,
        text,
      })),
    );
    expect(
      inventory.uncertainties.map(({ node }) =>
        node.X?.Type === "Word" && node.X.Parts?.[0]?.Type === "Lit"
          ? node.X.Parts[0].Value
          : null,
      ),
    ).toEqual(["u0", "u1", "u2", "u3"]);
  });

  it.each([10, 497, 498, 499, 500, 501, 520])(
    "for an elif chain of %i clauses at the nesting-limit boundary",
    (length) => {
      expectSameOutcome(elifChain(length));
    },
  );

  it("refuses a chain past the limit with the same typed error in both", () => {
    const outcome = expectSameOutcome(elifChain(520));
    expect(outcome).toMatchObject({
      thrown: { name: "ShAnalyzeMaxDepthError" },
    });
  });

  it.each([499, 500, 501])("for %i nested subshells", (depth) => {
    let cmd: Node = syntheticNode("CallExpr", {
      Args: [
        syntheticNode("Word", {
          Parts: [syntheticNode("Lit", { Value: "x" })],
        }),
      ],
    });
    for (let level = 0; level < depth; level++) {
      cmd = syntheticNode("Subshell", {
        Stmts: [syntheticNode("Stmt", { Cmd: cmd })],
      });
    }
    expectSameOutcome(cmd);
  });
});
