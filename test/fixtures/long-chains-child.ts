/**
 * Fresh-process driver for long flat chains: enumerates syntax trees whose spines are 10,000 links
 * long and prints one JSON outcome per named case, so the parent test can assert on each.
 *
 * The parsed case exercises a real long flat chain. Other trees are assembled from two-link parser
 * templates to cover several syntax shapes and records that cannot be expressed as valid source.
 * Their left spines follow the parser's nesting (`a + b + c` is `BinaryArithm(BinaryArithm(a, b), c)`).
 * Expected outcomes come from the meaning of the source, never from this program's output.
 */
import { AndStmt, LangZsh, parseSync, Pipe } from "sh-ast";
import type {
  ArithmExpr,
  BinaryCmd,
  CallExpr,
  CmdSubst,
  FlagsArithm,
  Node,
  IfClause,
  Stmt,
  TestExpr,
  Word,
} from "sh-ast";
import * as analysis from "sh-analysis";

/** Links per spine: well past the ~1,500-7,000 where recursive walks exhausted the stack. */
const LINKS = 10_000;

/** What the parent asserts per case: facts about sites and uncertainties, or the thrown failure. */
interface Outcome {
  readonly sites?: readonly {
    readonly argv0: string | null;
    readonly context: readonly string[];
  }[];
  readonly uncertainties?: readonly {
    readonly reason: string;
    readonly context: readonly string[];
    readonly isLeaf: boolean;
  }[];
  readonly failure?: {
    readonly name: string;
    readonly code: string | null;
    readonly isRangeError: boolean;
  };
}

/** Narrow a parsed record to the expected node type, or fail the driver loudly. */
function expectType<T extends Node["Type"]>(
  node: Node | null | undefined,
  type: T,
): Extract<Node, { Type: T }> {
  if (node?.Type !== type) {
    throw new Error(`template did not parse to ${type}`);
  }
  // `Type` discriminates the Node union, so the checked variant is exactly `T`'s record.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- discriminant checked on the previous line
  return node as Extract<Node, { Type: T }>;
}

/** A statement for `name` placed `offset` bytes into its source, giving sites distinct source positions. */
function stmtAt(name: string, offset: number): Stmt {
  const stmt = parseSync(`${" ".repeat(offset)}${name}`).Stmts?.[0];
  if (!stmt) throw new Error("no statement");
  return stmt;
}

/** The first command-substitution part of `echo $(x)`, whose statements are replaced by `stmt`. */
function cmdSubstOf(stmt: Stmt): CmdSubst {
  const word = expectType(parseSync("echo $(x)").Stmts?.[0]?.Cmd, "CallExpr")
    .Args?.[1];
  const part = expectType(word?.Parts?.[0], "CmdSubst");
  return { ...part, Stmts: [stmt] };
}

/** A word holding only one command substitution of `stmt`: `$(name)`. */
function substWord(stmt: Stmt): Word {
  const word = expectType(parseSync("echo $(x)").Stmts?.[0]?.Cmd, "CallExpr")
    .Args?.[1];
  if (!word) throw new Error("no word");
  return { ...word, Parts: [cmdSubstOf(stmt)] };
}

/** The literal word `1` from `(( 1 + 2 ))`: a link that contains no command. */
const ONE: Word = expectType(
  expectType(
    expectType(parseSync("(( 1 + 2 ))").Stmts?.[0]?.Cmd, "ArithmCmd").X,
    "BinaryArithm",
  ).X,
  "Word",
);

/** The two-link arithmetic template: `1 + 2`. */
const ARITH_LINK = expectType(
  expectType(parseSync("(( 1 + 2 ))").Stmts?.[0]?.Cmd, "ArithmCmd").X,
  "BinaryArithm",
);

/** The binary-test template: `-n a || -n b`. */
const TEST_LINK = expectType(
  expectType(parseSync("[[ -n a || -n b ]]").Stmts?.[0]?.Cmd, "TestClause").X,
  "BinaryTest",
);

/** `leftmost`, then `LINKS` further operands joined left-associatively; the last operand is `last`. */
function arithSpine(
  leftmost: ArithmExpr,
  middle: ArithmExpr,
  last: ArithmExpr,
): ArithmExpr {
  let spine: ArithmExpr = leftmost;
  for (let link = 0; link < LINKS; link++) {
    spine = { ...ARITH_LINK, X: spine, Y: link === LINKS - 1 ? last : middle };
  }
  return spine;
}

/** The same left-associative spine over a test expression's `||`. */
function testSpine(
  leftmost: TestExpr,
  middle: TestExpr,
  last: TestExpr,
): TestExpr {
  let spine: TestExpr = leftmost;
  for (let link = 0; link < LINKS; link++) {
    spine = { ...TEST_LINK, X: spine, Y: link === LINKS - 1 ? last : middle };
  }
  return spine;
}

/** `$(first)`, `$(last)` bracket a run of `1`s so both ends of a spine hold a hidden command. */
const FIRST = substWord(stmtAt("first", 10));
const LAST = substWord(stmtAt("last", 20_000));

/** Summarize a result without losing which node a finding names. */
function describeContext(
  context: readonly analysis.CommandContext[],
): string[] {
  return context.map((frame) => {
    switch (frame.kind) {
      case "if":
        return `if:${frame.branch}`;
      case "pipeline":
        return `pipeline:${String(frame.stage)}`;
      case "loop":
        return `loop:${frame.role}`;
      case "function":
        return `function:${String(frame.name)}`;
      case "and":
      case "or":
        return `${frame.kind}:${frame.side}`;
      default:
        return frame.kind;
    }
  });
}

/** Run one enumeration and condense it; a thrown failure is reported, never rethrown. */
function run(root: Node, leaf?: Node): Outcome {
  try {
    const inventory = analysis.enumerateCommands(root);
    return {
      sites: inventory.commands.map((site) => ({
        argv0: site.argv0.static ? site.argv0.text : null,
        context: describeContext(site.context),
      })),
      uncertainties: inventory.uncertainties.map((entry) => ({
        reason: entry.reason,
        context: describeContext(entry.context),
        isLeaf: entry.node === leaf,
      })),
    };
  } catch (error) {
    const code = error instanceof analysis.ShAnalysisError ? error.code : null;
    return {
      failure: {
        name: error instanceof Error ? error.constructor.name : typeof error,
        code,
        isRangeError: error instanceof RangeError,
      },
    };
  }
}

/**
 * The parsed command `source` (`x=$(( 1 + 2 ))` or `echo $(( 1 + 2 ))`) with its arithmetic
 * expansion's expression replaced by `spine`. The assignment-only form is a command without
 * argv, so it produces no site; the `echo` form does.
 */
function wrapArithmetic(source: string, spine: ArithmExpr): CallExpr {
  const call = expectType(parseSync(source).Stmts?.[0]?.Cmd, "CallExpr");
  const assign = call.Assigns?.[0];
  const word = assign ? assign.Value : call.Args?.[1];
  const expansion = expectType(word?.Parts?.[0], "ArithmExp");
  if (!word) throw new Error("no word");
  const replaced = { ...word, Parts: [{ ...expansion, X: spine }] };
  if (assign && call.Assigns) {
    return { ...call, Assigns: [{ ...assign, Value: replaced }] };
  }
  if (!call.Args) throw new Error("no arguments");
  return { ...call, Args: [call.Args[0], replaced] };
}

/** A chain of `LINKS` pipe-or-boolean links over the one-word statement `a`. */
function commandChain(source: string, op: typeof Pipe | typeof AndStmt): Node {
  const template = expectType(parseSync(source).Stmts?.[0]?.Cmd, "BinaryCmd");
  const leaf = stmtAt("a", 0);
  let spine: Stmt = leaf;
  for (let link = 0; link < LINKS; link++) {
    const cmd: BinaryCmd = { ...template, Op: op, X: spine, Y: leaf };
    spine = { ...leaf, Cmd: cmd };
  }
  return spine;
}

/** Recognizes the parser's `FlagsArithm` record among arbitrary values. */
function isFlagsArithm(value: unknown): value is FlagsArithm {
  return (
    typeof value === "object" &&
    value !== null &&
    "Type" in value &&
    value.Type === "FlagsArithm"
  );
}

/** The parser's own `FlagsArithm` record, found without assuming which field of the expansion holds it. */
function findFlagsArithm(root: unknown): FlagsArithm {
  const work: unknown[] = [root];
  while (work.length > 0) {
    const value = work.pop();
    if (isFlagsArithm(value)) {
      return value;
    }
    if (typeof value === "object" && value !== null) {
      const children: unknown[] = Object.values(value);
      work.push(...children);
    }
  }
  throw new Error("no FlagsArithm in template");
}

const cases: Record<string, () => Outcome> = {
  // x=$(( $(first) + 1 + 1 ... + 1 + $(last) ))
  "arithmetic expansion spine": () =>
    run(wrapArithmetic("x=$(( 1 + 2 ))", arithSpine(FIRST, ONE, LAST))),

  // echo $(( $(first) + 1 + ... + $(last) )): the command's own record contains the long chain
  "arithmetic expansion spine in a command argument": () =>
    run(wrapArithmetic("echo $(( 1 + 2 ))", arithSpine(FIRST, ONE, LAST))),

  // The same argument built by parsing a real 10,000-link flat arithmetic expression.
  "parsed arithmetic expansion in a command argument": () =>
    run(parseSync(`echo $(( $(first)${" + 1".repeat(LINKS - 1)} + $(last) ))`)),

  // (( $(first) + 1 + ... + $(last) ))
  "arithmetic command spine": () => {
    const cmd = expectType(
      parseSync("(( 1 + 2 ))").Stmts?.[0]?.Cmd,
      "ArithmCmd",
    );
    return run({ ...cmd, X: arithSpine(FIRST, ONE, LAST) });
  },

  // let "$(first)+1+...+$(last)"
  "let expression spine": () => {
    const cmd = expectType(parseSync("let 1+2").Stmts?.[0]?.Cmd, "LetClause");
    return run({ ...cmd, Exprs: [arithSpine(FIRST, ONE, LAST)] });
  },

  // arr[$(first)+1+...+$(last)]=v
  "array subscript spine": () => {
    const cmd = expectType(parseSync("a[1+2]=v").Stmts?.[0]?.Cmd, "CallExpr");
    const assign = cmd.Assigns?.[0];
    if (!assign) throw new Error("no assignment");
    return run({
      ...cmd,
      Assigns: [{ ...assign, Index: arithSpine(FIRST, ONE, LAST) }],
    });
  },

  // x=${y:$(first)+1+...+$(last)}
  "parameter slice offset spine": () => {
    const call = expectType(
      parseSync("x=${y:1+2}").Stmts?.[0]?.Cmd,
      "CallExpr",
    );
    const assign = call.Assigns?.[0];
    const expansion = expectType(assign?.Value?.Parts?.[0], "ParamExp");
    if (!assign?.Value || !call.Assigns || !expansion.Slice) {
      throw new Error("no slice");
    }
    const slice = { ...expansion.Slice, Offset: arithSpine(FIRST, ONE, LAST) };
    const value = { ...assign.Value, Parts: [{ ...expansion, Slice: slice }] };
    return run({ ...call, Assigns: [{ ...assign, Value: value }] });
  },

  // [[ -n $(first) || -n b || ... || -n $(last) ]]
  "test expression || spine": () => {
    const clause = expectType(
      parseSync("[[ -n a ]]").Stmts?.[0]?.Cmd,
      "TestClause",
    );
    const unary = expectType(clause.X, "UnaryTest");
    const link = (word: Word): TestExpr => ({ ...unary, X: word });
    const plain = link(ONE);
    return run({
      ...clause,
      X: testSpine(link(FIRST), plain, link(LAST)),
    });
  },

  // x=$(( 1 + 1 + ... + a[(r)x] )): a Zsh subscript pattern is kept as raw text, so its
  // contents stay an explicit uncertainty however far down the spine it sits.
  "opaque zsh subscript at the end of a spine": () => {
    const flags = findFlagsArithm(
      parseSync('echo "${a[(r)x]}"', { Variant: LangZsh }),
    );
    return run(
      wrapArithmetic("x=$(( 1 + 2 ))", arithSpine(ONE, ONE, flags)),
      flags,
    );
  },

  // a && a && ... && a  (10,000 links)
  "&& chain": () => {
    const root = commandChain("a && b", AndStmt);
    const outcome = run(root);
    return outcome;
  },

  // a | a | ... | a  (10,000 links)
  "pipeline chain": () => run(commandChain("a | b", Pipe)),

  // if a; then :; elif ...; elif ...; fi with 10,000 elif clauses whose condition and body are
  // empty (not parseable today): no statement inside the chain, so no command to report.
  "elif chain without statements": () => {
    const top = expectType(
      parseSync("if a; then b; elif c; then d; fi").Stmts?.[0]?.Cmd,
      "IfClause",
    );
    const elif = expectType(top.Else, "IfClause");
    let chain: IfClause = { ...elif, Cond: [], Then: [], Else: null };
    for (let link = 0; link < LINKS; link++) {
      chain = {
        ...chain,
        Else: { ...elif, Cond: [], Then: [], Else: chain.Else },
      };
    }
    return run({ ...top, Then: [], Else: chain });
  },

  // if a; then b; elif c; then d; elif ... fi with 10,000 elif clauses holding statements:
  // genuine nesting depth, so the analyzer's defensive limit applies.
  "elif chain with statements": () => {
    const top = expectType(
      parseSync("if a; then b; elif c; then d; fi").Stmts?.[0]?.Cmd,
      "IfClause",
    );
    const elif = expectType(top.Else, "IfClause");
    let chain: IfClause = { ...elif, Else: null };
    for (let link = 0; link < LINKS; link++) {
      chain = { ...elif, Else: chain };
    }
    return run({ ...top, Else: chain });
  },
};

const results: Record<string, Outcome> = {};
for (const [name, build] of Object.entries(cases)) {
  results[name] = build();
}
console.log(JSON.stringify(results));
