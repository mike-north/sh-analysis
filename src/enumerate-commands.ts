/** Enumerates invocations on caller-owned faithful records while retaining syntactic contexts. */
import { AndStmt, OrStmt, Pipe, PipeAll } from "sh-ast";
import { nodePos } from "sh-ast";
import { ShAnalyzeMaxDepthError } from "./errors.js";
import type {
  BinaryCmd,
  CallExpr,
  GoString,
  FlagsArithm,
  IfClause,
  Node,
  Stmt,
} from "sh-ast";
import { isSyntaxNode, nodeArray } from "./node-helpers.js";
import { resolveWord } from "./resolve-word.js";
import type { WordResolution } from "./resolve-word.js";

/**
 * A single frame of the path from the root of the tree down to a
 * {@link CommandSite}, describing *how* the command is reached — never
 * whether it is safe to run. `CommandSite.context` is an ordered stack of
 * these, outermost frame first:
 *
 * - `'and'`/`'or'` (`side: 'right'`) — the right-hand operand of a
 *   `BinaryCmd` (mvdan/sh's node for both `&&` and `||`); only the right
 *   side is tagged; the left side inherits the surrounding context
 *   unchanged, since it runs unconditionally relative to this operator.
 * - `'pipeline'` (`stage: n`) — one stage of a `|`/`|&` chain (also a
 *   `BinaryCmd`, left-associatively nested by mvdan/sh); every stage is
 *   tagged, 0-indexed left to right, regardless of whether the chain mixes
 *   `|` and `|&`.
 * - `'subshell'` — inside a `Subshell` (`( ... )`).
 * - `'cmdSubst'`/`'procSubst'` — inside a `CmdSubst` (`$(...)`/backticks) or
 *   `ProcSubst` (`<(...)`/`>(...)`) reached from *any* word-bearing
 *   position (an argument, a redirection target, a case subject, a loop's
 *   word list, an assignment value, a test/arithmetic operand, …) — not
 *   only from `CallExpr.Args`.
 * - `'if'` (`branch: 'cond' | 'then' | 'else'`) — inside an `IfClause`'s
 *   condition, then-branch, or else-branch (mvdan/sh nests `elif` chains as
 *   `IfClause.Else` pointing to another `IfClause`, so an `elif`'s own
 *   condition/then are reached through an `{kind:'if',branch:'else'}` frame
 *   first, then their own `'cond'`/`'then'` frame — reflecting the real
 *   nesting rather than collapsing it).
 * - `'case'` — inside one `CaseClause` branch's statement list (not the
 *   case subject word or the patterns).
 * - `'loop'` (`role` is `'body'` or `'cond'`) — inside a `ForClause`'s
 *   statement list (`role: 'body'` only — a `for` loop has no
 *   statement-list condition) or a `WhileClause`'s (`role: 'cond'` for the
 *   condition, `role: 'body'` for the loop body).
 * - `'function'` (`name`) — inside a `FuncDecl`'s body; `name` is the
 *   function's literal name text.
 * - `'background'`/`'negated'` — the enclosing `Stmt` has mvdan/sh's
 *   Background/Negated flag set (`cmd &`, `! cmd`).
 * - `'coproc'` — inside a `CoprocClause`'s statement (a `coproc` block,
 *   optionally named).
 *
 * A `Block` grouping (`{ ...; }`) and a `TimeClause` (`time cmd`) are
 * deliberately transparent — grouping and timing a command doesn't change
 * how it's reached, so no frame is added for either.
 *
 * This union may grow in a **minor** release — a future mvdan/sh grammar
 * construct this module starts modeling can add a new `kind` variant
 * without that being a breaking change (mirroring
 * {@link WordResolutionReason}'s semver policy in `resolve-word.ts`). It is
 * deliberately not sealed against extension elsewhere in the codebase.
 * Every existing variant's shape (its extra fields, if any) is stable —
 * only new variants are ever added — so an exhaustive compile-time
 * `switch` over `.kind` should still include a `default` case to stay
 * forward-compatible.
 *
 * @public
 */
export type CommandContext =
  | { readonly kind: "and"; readonly side: "right" }
  | { readonly kind: "or"; readonly side: "right" }
  | { readonly kind: "pipeline"; readonly stage: number }
  | { readonly kind: "subshell" }
  | { readonly kind: "cmdSubst" }
  | { readonly kind: "procSubst" }
  | { readonly kind: "if"; readonly branch: "then" | "else" | "cond" }
  | { readonly kind: "case" }
  | { readonly kind: "loop"; readonly role: "body" | "cond" }
  | { readonly kind: "function"; readonly name: GoString }
  | { readonly kind: "background" }
  | { readonly kind: "negated" }
  | { readonly kind: "coproc" };

/**
 * One place in the tree representing a simple-command invocation — a `CallExpr`
 * node, together with its resolved words and the path used to reach it.
 * Facts only, matching {@link resolveWord}'s posture: no safety verdict, no
 * hardcoded command/wrapper list. A dynamic (`static: false`) `argv0` is a
 * normal, expected result — not an error and not itself reported as
 * "unknown"/"unsafe".
 *
 * @public
 */
export interface CommandSite {
  /** The `CallExpr` node this site was found at. */
  readonly node: CallExpr;
  /**
   * `resolveWord` applied to the first word (`argv[0]`), with
   * `{ context: 'command-argument' }` — every `CallExpr` word is an
   * ordinary command-argument position, never an assignment value, so
   * only a word-initial unquoted `~` triggers tilde expansion (an
   * unquoted `~` after a `:`, e.g. `a:~/b`, is literal text here — see
   * `ResolveWordOptions.context`'s doc comment).
   */
  readonly argv0: WordResolution;
  /**
   * `resolveWord` applied in argument order (same `{ context: 'command-argument' }`
   * as {@link CommandSite.argv0}). Indices align directly with {@link CommandSite.node}'s
   * Args array: a null slot is retained as an unsupported resolution, never skipped.
   */
  readonly argv: readonly WordResolution[];
  /** The path from the tree root to this site, outermost frame first. */
  readonly context: readonly CommandContext[];
}

/**
 * An interpretation boundary whose contents the selected Go syntax model leaves opaque.
 * This does not claim a hidden command exists; it prevents an empty represented subtree
 * from being mistaken for evidence that no further execution is possible.
 * @public
 */
export interface CommandUncertainty {
  /** The selected Go representation preserves a Zsh subscript pattern as raw literal text. */
  readonly reason: "opaque-zsh-subscript";
  /** Original syntax construct containing the uninterpreted pattern, retained by identity. */
  readonly node: FlagsArithm;
  /** Syntactic path reaching this construct, outermost frame first. */
  readonly context: readonly CommandContext[];
}

/**
 * Represented command sites and interpretation limits observed in one syntax subtree.
 * A command list does not prove execution completeness when uncertainties are present;
 * even an uncertainty-free result describes syntax under this analyzer's assumptions.
 * @public
 */
export interface CommandInventory {
  /** Commands represented by explicit syntax records, in source order. */
  commands: CommandSite[];
  /** Opaque constructs limiting nested execution inventory, in discovery order. */
  uncertainties: CommandUncertainty[];
}

/**
 * The selected Go parser stores Zsh flagged-subscript patterns in a literal-only Word.
 * Inspect that representation rather than interpreting the pattern's raw bytes. Explicit
 * arithmetic/expansion children in caller-built records remain ordinary traversable syntax.
 */
function opaqueSubscript(node: FlagsArithm): boolean {
  return (
    node.X?.Type === "Word" &&
    Boolean(node.X.Parts?.length) &&
    node.X.Parts?.every((part) => part?.Type === "Lit") === true
  );
}

/** Pipeline operators share stage context regardless of stderr piping. */
function isPipeOp(op: unknown): boolean {
  return op === Pipe || op === PipeAll;
}

/**
 * The maximum number of *genuinely nested* structural frames (subshells,
 * command/process substitutions, `if`/`case`/loop/function/`time`/`{ }`
 * bodies, chained `elif`) {@link enumerateCommands} descends through before
 * throwing {@link ShAnalyzeMaxDepthError} — a defensive backstop against
 * pathological/adversarial input (a native stack overflow is an
 * uncontrolled crash, not a catchable error). A long *linear* chain
 * (`|`/`&&`/`||` of any length) never grows this counter — see
 * `flattenPipelineStages`'s and `visitBinaryCmd`'s doc comments — only real
 * nesting does.
 *
 * This value is deliberately *not* a round, "generous"-sounding number
 * like 10,000: measured empirically (synthetic nested-`Subshell` trees,
 * this repo's actual `vitest` worker environment, default Node/V8 stack
 * size — see `analyze-enumerate-commands.test.ts`'s depth-guard describe
 * block), this module's own recursive descent through a real
 * `Subshell`-in-`Subshell` chain hits a raw, uncatchable
 * `RangeError: Maximum call stack size exceeded` starting somewhere around
 * depth 1,000–1,500 (the exact point varies run to run — it's a hard
 * native-stack limit, not a clean threshold). A depth guard set at 10,000
 * would never actually fire: the real crash happens first. 500 leaves
 * roughly 2–3x headroom below the *lowest* observed native-crash depth,
 * while still comfortably exceeding any realistic hand-written script's
 * nesting (this is pathological-input protection, not a normal-usage
 * ceiling).
 */
const MAX_STRUCTURAL_DEPTH = 500;

/** Extend the current syntactic path without changing another branch's context. */
function pushContext(
  context: readonly CommandContext[],
  frame: CommandContext,
): readonly CommandContext[] {
  return [...context, frame];
}

/**
 * Scans `value` — a word, an assignment, a test/arithmetic expression, a
 * redirect, or an array of any of these — for `CmdSubst`/`ProcSubst`
 * boundaries reachable from it, however deeply nested (through
 * `DblQuoted`, `ParamExp`'s `Exp`/`Repl`/`Slice`/`nestedparam`, array
 * elements, arithmetic operands, …), and hands each one found off to
 * {@link visitStmtList} with the corresponding context frame pushed. This is
 * a plain structural walk (discover children the same way {@link walk}
 * does) rather than a hand-modeled traversal of every one of mvdan/sh's
 * expression-shaped fields, because that set is large and not the part of
 * the grammar this module's context-aware descent is about — the
 * *command*-bearing structure (`BinaryCmd`, `IfClause`, loops, …) is
 * hand-modeled in {@link visitCommand}; this helper's only job is finding
 * where a word-shaped subtree stops being "just an expression" and starts
 * containing statements again.
 *
 * `depth` is {@link visitStmt}'s structural-nesting counter, passed through
 * unchanged for the generic per-field walk (a purely expression-shaped
 * subtree — e.g. deeply nested `ParamExp` — is a different, out-of-scope
 * risk from the command-structural nesting {@link MAX_STRUCTURAL_DEPTH}
 * guards against) and incremented by one only when a `CmdSubst`/`ProcSubst`
 * boundary is crossed, since that's a genuine additional level of
 * command-bearing nesting (see {@link ShAnalyzeMaxDepthError}'s doc
 * comment).
 */
function scanForHiddenCommands(
  root: unknown,
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  // Values still to inspect, with the next one to visit on top. Expression
  // spines (`a + b + c + …`, `[[ x || y || … ]]`) nest one record per link, so
  // the walk keeps its place on the heap: native stack use does not grow with
  // the length of the spine. Children are pushed in reverse so they are
  // visited in field order, which fixes the discovery order of uncertainties
  // and of the commands reached through substitutions.
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        pending.push(value[index]);
      }
      continue;
    }
    if (
      typeof value !== "object" ||
      value === null ||
      value instanceof Uint8Array
    ) {
      continue;
    }
    if (
      isSyntaxNode(value) &&
      value.Type === "FlagsArithm" &&
      opaqueSubscript(value)
    ) {
      inventory.uncertainties.push({
        reason: "opaque-zsh-subscript",
        node: value,
        context,
      });
    }
    if (isSyntaxNode(value) && value.Type === "CmdSubst") {
      visitStmtList(
        nodeArray(value.Stmts),
        pushContext(context, { kind: "cmdSubst" }),
        inventory,
        depth + 1,
      );
      continue;
    }
    if (isSyntaxNode(value) && value.Type === "ProcSubst") {
      visitStmtList(
        nodeArray(value.Stmts),
        pushContext(context, { kind: "procSubst" }),
        inventory,
        depth + 1,
      );
      continue;
    }
    const fields = Object.values(value);
    for (let index = fields.length - 1; index >= 0; index--) {
      pending.push(fields[index]);
    }
  }
}

/** A statement list preserves its enclosing context; only the owning construct adds a frame. */
function visitStmtList(
  stmts: readonly Stmt[],
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  for (const stmt of stmts) {
    visitStmt(stmt, context, inventory, depth);
  }
}

/**
 * Visits one `Stmt`. Every genuinely-nested recursive path through this
 * module funnels through here (directly, or via {@link visitStmtList}) —
 * see {@link MAX_STRUCTURAL_DEPTH}'s doc comment — so this is where the
 * depth guard is enforced: a `depth` that has grown past
 * {@link MAX_STRUCTURAL_DEPTH} throws {@link ShAnalyzeMaxDepthError} rather
 * than recursing further.
 */
function visitStmt(
  stmt: Stmt,
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  if (depth > MAX_STRUCTURAL_DEPTH) {
    throw new ShAnalyzeMaxDepthError(MAX_STRUCTURAL_DEPTH);
  }
  let stmtContext = context;
  if (stmt.Negated) {
    stmtContext = pushContext(stmtContext, { kind: "negated" });
  }
  if (stmt.Background) {
    stmtContext = pushContext(stmtContext, { kind: "background" });
  }
  scanForHiddenCommands(stmt.Redirs, stmtContext, inventory, depth);
  const cmd = stmt.Cmd;
  if (isSyntaxNode(cmd)) {
    visitCommand(cmd, stmtContext, inventory, depth);
  }
}

/**
 * Recovers the left-to-right stages of a `|`/`|&` pipeline from `cmd` (a
 * `BinaryCmd` whose own `Op` is already known to be a pipe-family
 * operator). mvdan/sh nests these left-associatively — `a | b | c` is
 * `BinaryCmd(x: Stmt{BinaryCmd(x: a, y: b)}, y: Stmt{c})` — so a chain of
 * `n` stages is `n - 1` levels of nested `BinaryCmd`. Recovering stages
 * walks that left ("x") spine with an explicit work stack instead of
 * recursing per level, so a pipeline of any realistic length (this module
 * is tested to 5,000+ stages) uses O(1) native call-stack frames here,
 * regardless of `n` — the array-backed stack lives on the heap, not the
 * call stack. The work-stack ordering (push `y` then `x`, i.e. `x` on top)
 * visits the left operand fully before the right operand, including the — per this analyzer's own
 * left-associative-only model — hypothetical case of a further pipe-family
 * `BinaryCmd` on the `y` side. Mixed `|`/`|&` chains flatten into a single
 * pipeline (this analyzer doesn't distinguish "stderr also piped" in
 * {@link CommandContext} — only stage position).
 */
function flattenPipelineStages(cmd: BinaryCmd): Stmt[] {
  const stages: Stmt[] = [];
  const workStack: (Stmt | null)[] = [cmd.Y, cmd.X];
  while (workStack.length > 0) {
    const operandStmt = workStack.pop();
    if (!isSyntaxNode(operandStmt)) {
      continue;
    }
    const innerCmd = operandStmt.Cmd;
    if (
      isSyntaxNode(innerCmd) &&
      innerCmd.Type === "BinaryCmd" &&
      isPipeOp(innerCmd.Op)
    ) {
      // Push `y` then `x` so `x` — the side that keeps the chain going in
      // the left-associative case — is popped (processed) first.
      workStack.push(innerCmd.Y, innerCmd.X);
    } else {
      stages.push(operandStmt);
    }
  }
  return stages;
}

/**
 * Visits a non-pipe-family `BinaryCmd` (`&&`/`||`, or a future operator
 * this module doesn't specifically recognize). Like pipelines, `&&`/`||`
 * chains nest left-associatively — `a && b && c` is
 * `BinaryCmd(x: Stmt{BinaryCmd(x: a, y: b)}, y: Stmt{c})`, and a mixed
 * `a && b || c` chain is still a single left-nested spine
 * (`(a && b) || c`) — so a long chain is walked iteratively here too,
 * exactly mirroring {@link flattenPipelineStages}'s technique: descend the
 * left ("x") spine with a `while` loop instead of recursion, collecting
 * each level's right ("y") operand (and which context frame, if any, it
 * gets — `'and'`/`'or'`, or none for an unrecognized operator, matching
 * the original per-level logic) along the way, stopping either at a plain
 * (non-`BinaryCmd`) leftmost operand or at a pipe-family `BinaryCmd` (a
 * different sub-structure, visited via the ordinary `visitStmt` →
 * `visitCommand` → `visitBinaryCmd` dispatch below — a single, bounded
 * recursive step, not per-chain-length).
 *
 * Every operand this function ultimately visits (the collected right-hand
 * operands and the leftmost operand) is one genuine structural hop away
 * from this `BinaryCmd` node, so each gets `depth + 1` — the *same*
 * incremented value for every one of them, regardless of chain length:
 * they're siblings under this node's flattened spine, not nested inside
 * one another, so the depth counter must not grow with stage count (only
 * {@link flattenPipelineStages}'s sibling pipeline stages get the same
 * treatment, for the same reason).
 */
function visitBinaryCmd(
  cmd: BinaryCmd,
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  const op = cmd.Op;
  if (isPipeOp(op)) {
    const stages = flattenPipelineStages(cmd);
    stages.forEach((stage, index) => {
      visitStmt(
        stage,
        pushContext(context, { kind: "pipeline", stage: index }),
        inventory,
        depth + 1,
      );
    });
    return;
  }
  /** Deferred right branches retain the conditional context of their own Boolean operator. */
  interface RightOperand {
    readonly stmt: Stmt;
    readonly frame: CommandContext | undefined;
  }
  const rightOperands: RightOperand[] = [];
  let spine: BinaryCmd = cmd;
  for (;;) {
    const spineOp = spine.Op;
    const frame: CommandContext | undefined =
      spineOp === AndStmt
        ? { kind: "and", side: "right" }
        : spineOp === OrStmt
          ? { kind: "or", side: "right" }
          : undefined;
    const y = spine.Y;
    if (isSyntaxNode(y)) {
      rightOperands.push({ stmt: y, frame });
    }
    const x = spine.X;
    if (!isSyntaxNode(x)) {
      break;
    }
    const innerCmd = x.Cmd;
    if (
      isSyntaxNode(innerCmd) &&
      innerCmd.Type === "BinaryCmd" &&
      !isPipeOp(innerCmd.Op)
    ) {
      spine = innerCmd;
      continue;
    }
    // `x` is the leftmost operand: not a further same-family BinaryCmd
    // link, so this is where the spine walk ends — visit it with the
    // *outer* (unmodified) context: no right-branch condition applies to it.
    visitStmt(x, context, inventory, depth + 1);
    break;
  }
  for (const { stmt, frame } of rightOperands) {
    visitStmt(
      stmt,
      frame ? pushContext(context, frame) : context,
      inventory,
      depth + 1,
    );
  }
}

/**
 * Conditions and alternatives retain distinct paths, including nested elif/else structure.
 * A chained `elif` is followed in a loop, so a long chain does not deepen the native stack
 * even when its clauses contain no statements to trip the depth guard.
 */
function visitIfClause(
  clause: IfClause,
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  let current = clause;
  let currentContext = context;
  let currentDepth = depth;
  for (;;) {
    visitStmtList(
      nodeArray(current.Cond),
      pushContext(currentContext, { kind: "if", branch: "cond" }),
      inventory,
      currentDepth,
    );
    visitStmtList(
      nodeArray(current.Then),
      pushContext(currentContext, { kind: "if", branch: "then" }),
      inventory,
      currentDepth,
    );
    const elseClause = current.Else;
    if (!isSyntaxNode(elseClause)) {
      return;
    }
    // A chained `elif` — mvdan/sh models it as `IfClause.Else` pointing to
    // another `IfClause` — is one more genuine level of nesting than
    // `cond`/`then` above, so it gets its own `depth + 1` (a long `elif`
    // chain must still trip {@link MAX_STRUCTURAL_DEPTH}, since — unlike
    // `&&`/`||`/pipelines — this module does not special-case flattening
    // it).
    current = elseClause;
    currentContext = pushContext(currentContext, {
      kind: "if",
      branch: "else",
    });
    currentDepth += 1;
  }
}

/** Command structures define context; expression-shaped children expose only represented substitutions. */
function visitCommand(
  cmd: Node,
  context: readonly CommandContext[],
  inventory: CommandInventory,
  depth: number,
): void {
  switch (cmd.Type) {
    case "CallExpr": {
      scanForHiddenCommands(cmd.Assigns, context, inventory, depth);
      scanForHiddenCommands(cmd.Args, context, inventory, depth);
      // Argument positions carry command-line meaning. A nil pointer is an
      // unsupported argument, not permission to shift later words left.
      const args = cmd.Args ?? [];
      if (args.length > 0) {
        const argv = args.map((word): WordResolution =>
          word === null
            ? { static: false, reason: "unsupported" }
            : resolveWord(word, { context: "command-argument" }),
        );
        inventory.commands.push({ node: cmd, argv0: argv[0], argv, context });
      }
      return;
    }
    case "BinaryCmd":
      visitBinaryCmd(cmd, context, inventory, depth);
      return;
    case "Block":
      // Transparent grouping (`{ ...; }`) — no context frame, but still one
      // genuine level of structural nesting for depth-guard purposes (a
      // pathological `{ { { ... } } }` chain must still trip the guard).
      visitStmtList(nodeArray(cmd.Stmts), context, inventory, depth + 1);
      return;
    case "Subshell":
      visitStmtList(
        nodeArray(cmd.Stmts),
        pushContext(context, { kind: "subshell" }),
        inventory,
        depth + 1,
      );
      return;
    case "IfClause":
      visitIfClause(cmd, context, inventory, depth + 1);
      return;
    case "CaseClause": {
      scanForHiddenCommands(cmd.Word, context, inventory, depth);
      for (const item of nodeArray(cmd.Items)) {
        scanForHiddenCommands(item.Patterns, context, inventory, depth);
        visitStmtList(
          nodeArray(item.Stmts),
          pushContext(context, { kind: "case" }),
          inventory,
          depth + 1,
        );
      }
      return;
    }
    case "ForClause": {
      scanForHiddenCommands(cmd.Loop, context, inventory, depth);
      visitStmtList(
        nodeArray(cmd.Do),
        pushContext(context, { kind: "loop", role: "body" }),
        inventory,
        depth + 1,
      );
      return;
    }
    case "WhileClause": {
      visitStmtList(
        nodeArray(cmd.Cond),
        pushContext(context, { kind: "loop", role: "cond" }),
        inventory,
        depth + 1,
      );
      visitStmtList(
        nodeArray(cmd.Do),
        pushContext(context, { kind: "loop", role: "body" }),
        inventory,
        depth + 1,
      );
      return;
    }
    case "FuncDecl": {
      const nameNode = cmd.Name;
      const nameText = nameNode?.Value ?? "";
      const body = cmd.Body;
      if (isSyntaxNode(body)) {
        visitStmt(
          body,
          pushContext(context, { kind: "function", name: nameText }),
          inventory,
          depth + 1,
        );
      }
      return;
    }
    case "CoprocClause": {
      scanForHiddenCommands(cmd.Name, context, inventory, depth);
      const stmt = cmd.Stmt;
      if (isSyntaxNode(stmt)) {
        visitStmt(
          stmt,
          pushContext(context, { kind: "coproc" }),
          inventory,
          depth + 1,
        );
      }
      return;
    }
    case "DeclClause":
      scanForHiddenCommands(cmd.Args, context, inventory, depth);
      return;
    case "LetClause":
      scanForHiddenCommands(cmd.Exprs, context, inventory, depth);
      return;
    case "TestClause":
      scanForHiddenCommands(cmd.X, context, inventory, depth);
      return;
    case "ArithmCmd":
      scanForHiddenCommands(cmd.X, context, inventory, depth);
      return;
    case "TestDecl": {
      scanForHiddenCommands(cmd.Description, context, inventory, depth);
      const body = cmd.Body;
      if (isSyntaxNode(body)) {
        visitStmt(body, context, inventory, depth + 1);
      }
      return;
    }
    case "TimeClause": {
      // Transparent (`time cmd`) — no context frame, but still one genuine
      // level of structural nesting for depth-guard purposes.
      const stmt = cmd.Stmt;
      if (isSyntaxNode(stmt)) {
        visitStmt(stmt, context, inventory, depth + 1);
      }
      return;
    }
    default:
      // Not one of mvdan/sh's `syntax.Command` variants — e.g. a `Word` or
      // `Assign` passed directly as `enumerateCommands`' root, or a future
      // Command type this module doesn't know yet. Fall back to scanning it
      // as an expression subtree rather than silently finding nothing.
      scanForHiddenCommands(cmd, context, inventory, depth);
  }
}

/**
 * Observes represented command invocations (`CallExpr`) reachable from `root`,
 * with its resolved words ({@link resolveWord}) and the path used to reach
 * it ({@link CommandContext}). Descends everywhere a command can occur:
 * statement lists, both sides of `&&`/`||`/pipelines, subshells/blocks,
 * if/case branches *and* conditions, loop bodies *and* conditions, function
 * bodies, background/negated/coproc statements, and — critically —
 * `CmdSubst`/`ProcSubst` nested inside words, wherever those words occur
 * (arguments, redirection targets, case subjects/patterns, loop word
 * lists, assignment values, test/arithmetic operands, …), not only inside
 * `CallExpr.Args`.
 *
 * An assignment-only `CallExpr` (`FOO=bar`, `args` empty) has no first word
 * to resolve and is not itself a command invocation — no program runs — so
 * it produces no {@link CommandSite}; any command substitution nested in
 * its assigned value (`FOO=$(sub)`) is still found and reported.
 *
 * `commands` are sorted by source position (`nodePos(node).Offset`), so nested
 * command substitutions and out-of-structural-order redirection targets
 * still come back in source order regardless of traversal order.
 *
 * Facts only, matching {@link resolveWord}'s posture: no safety verdict, no
 * command/wrapper allowlist or denylist, no dataflow. A statically unknown
 * `argv0` (`static: false`) is a normal, expected result.
 *
 * A long *linear* chain — `|`/`|&`/`&&`/`||` of any realistic length — is
 * traversed iteratively and never risks a stack overflow or trips the
 * nesting-depth guard below, regardless of how many stages/links it has.
 *
 * @param root - Any `Node` — typically a `File` from `parseSync`, but any
 * subtree (a `Stmt`, a `Command`, or even a bare `Word`) is handled.
 * Raw-pattern Zsh subscripts produce explicit uncertainties rather than invented
 * commands or a claim that their raw contents cannot execute.
 * The depth guard also applies to caller-built or mutated trees.
 * @throws {@link ShAnalyzeMaxDepthError} if `root`'s genuinely nested
 * structure (subshells within subshells, chained command/process
 * substitutions, deeply nested `if`/`case`/loop/function/`time`/`{ }`
 * bodies, chained `elif`) exceeds this module's defensive recursion-depth
 * guard. No partial result is returned; callers decide how to handle refusal.
 * @public
 */
export function enumerateCommands(root: Node): CommandInventory {
  const inventory: CommandInventory = { commands: [], uncertainties: [] };
  if (root.Type === "File") {
    visitStmtList(nodeArray(root.Stmts), [], inventory, 0);
  } else if (root.Type === "Stmt") {
    visitStmt(root, [], inventory, 0);
  } else {
    visitCommand(root, [], inventory, 0);
  }
  inventory.commands = inventory.commands
    .map((site) => ({ site, offset: nodePos(site.node).Offset }))
    .sort((a, b) => a.offset - b.offset)
    .map(({ site }) => site);
  return inventory;
}
