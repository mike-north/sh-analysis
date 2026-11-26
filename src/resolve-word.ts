/** Resolves faithful upstream word records without evaluating shell expansions. */
import type { Node } from "sh-ast";
import { observeBraces } from "./brace-observation.js";
import { decodeAnsiCString } from "./ansi-c-escapes.js";
import { decodeDblQuotedLit, decodeUnquotedLit } from "./decode-lit.js";
import { nodeArray } from "./node-helpers.js";

/**
 * Why a {@link resolveWord} result is `static: false`: the word's exact
 * value cannot be classified as one reliably known literal word.
 *
 * - `'expansion'` — the word contains a `ParamExp` (`$x`, `${x}`), a
 *   `CmdSubst` (command substitution, either `$(...)` or backtick form), an
 *   `ArithmExp` (`$((expr))`), or a `ProcSubst` (`<(cmd)`/`>(cmd)`) part:
 *   its value depends on program state (variables, command output, process
 *   substitution) that only exists at run time.
 * - `'tilde'` — an unquoted, unescaped `~` can trigger tilde expansion.
 *   This includes a word-initial tilde, plus eligible tildes after `:` in assignment values
 *   or after `=` or `:` in assignment-shaped command arguments. The result
 *   depends on the environment or user database. See
 *   {@link ResolveWordOptions.context} for the applicable positions.
 * - `'glob'` — an `ExtGlob` part or possible filename generation from
 *   unquoted literal text. The literal check recognizes unescaped `*`,
 *   `?`, and `(` for Zsh pattern groups or qualifiers. It also recognizes
 *   a bracket expression when an unquoted `[` has a later unquoted `]`
 *   in the same word. The result depends on the filesystem at run time.
 * - `'brace'` — the word contains a `BraceExp` part or the pinned upstream
 *   `syntax.SplitBraces` produces one on a private observation copy (Bash
 *   Reference Manual §3.5.1, "Brace Expansion"). Parser output is unchanged.
 *   This reports potential expansion in supporting dialects; a bare Word has
 *   no dialect or shell-option state, so even POSIX-parsed words receive the
 *   conservative classification. It does not claim POSIX sh expands braces.
 * - `'locale'` — the word contains an ANSI-C Unicode escape for a non-ASCII
 *   scalar, whose output depends on the shell locale, or a `$"..."` string
 *   translated using the current locale's catalog (Bash Reference Manual
 *   §3.1.2.5, "Locale-Specific Translation"). For a locale-translated string,
 *   the analyzer checks its `DblQuoted.Dollar` flag before visiting any
 *   children, so `$"hi $x"` reports `'locale'`.
 * - `'unsupported'` — the input cannot support an exact Unicode-text claim:
 *   a literal contains a backslash whose meaning depends on missing context;
 *   an escape crosses caller-constructed word-part boundaries; a brace candidate
 *   has escape handling this analyzer cannot trust; a word contains nil/typed
 *   nil parts or byte-valued strings; or ANSI-C quoting produces NUL, non-ASCII
 *   byte escapes, or non-scalar Unicode escapes (U+D800..U+DFFF or values above
 *   U+10FFFF, such as `$'\\uD800'` and `$'\\UFFFFFFFF'`). This analyzer
 *   reports exact text only for escapes whose output can be represented
 *   faithfully as a JavaScript string.
 *
 * Reason descriptions do not establish universal precedence among features.
 * Whole-word `unsupported` preflight takes precedence even when a caller has
 * already supplied a `BraceExp`: an escape crossing parts can invalidate the
 * apparent quoting boundaries, and an escape-uncertain brace candidate remains
 * uncertain. A known `BraceExp` remains observable alongside independently
 * quoted literals and escapes with known quoting rules. After preflight, an
 * earlier uncertainty can determine the result before visiting that part.
 *
 * This union may grow in a **minor** release — new mvdan/sh word-part node
 * types, or new statically-shaped-but-dynamic categories, can add new reason
 * strings without that being a breaking change. It is deliberately not
 * sealed against extension elsewhere in the codebase. A reason string this
 * version of the package doesn't yet know about only ever accompanies
 * `static: false`, never changes the meaning of `static: true`, so runtime
 * consumers that only branch on `.static` are safe by construction across
 * such additions; an exhaustive compile-time `switch` over `.reason` should
 * still include a `default` case to stay forward-compatible.
 *
 * @public
 */
export type WordResolutionReason =
  "expansion" | "tilde" | "glob" | "brace" | "locale" | "unsupported";

/**
 * The result of statically resolving a `Word` node's text. Reports facts
 * only — never a safety verdict, never a hardcoded command/wrapper list.
 * `static: false` ("unknowable") is a first-class, valid result, not an
 * error condition.
 *
 * @public
 */
export type WordResolution =
  | {
      /** The word is a compile-time-known string. */
      readonly static: true;
      /** The word's exact resolved text (quotes and escapes removed). */
      readonly text: string;
    }
  | {
      /** The word has potential expansion or cannot be resolved reliably by this analyzer. */
      readonly static: false;
      /** Why this word cannot be statically resolved. */
      readonly reason: WordResolutionReason;
    };

/**
 * Options controlling expansion detection and escape decoding in {@link resolveWord}.
 *
 * @public
 */
export interface ResolveWordOptions {
  /**
   * Which grammar position `word` occupies. Both positions allow
   * tilde expansion at the start of the word.
   *
   * - `'command-argument'` — a simple-command word. In normal Bash mode,
   *   assignment-shaped arguments such as `ARG=~/x` and `ARG=a:~/x` can
   *   expand an unquoted tilde after the assignment operator or a colon
   *   in the value. Ordinary arguments such as `a:~/x` keep that tilde literal.
   * - `'assignment-value'` — the value side of a shell assignment (e.g.
   *   the `/foo:~/bar` in `PATH=/foo:~/bar`). Bash additionally expands an
   *   unquoted tilde immediately following an unquoted colon in the value.
   *   Zsh can also expand a tilde after a backslash-escaped colon or before
   *   a quoted or escaped slash. This context accounts for both shells.
   *
   * Both positions also establish the escape rules for top-level `Lit` parts.
   * With the option omitted, either position can trigger a tilde result, and
   * a top-level literal with a backslash can report `'unsupported'` because
   * the enclosing escape rules are unknown.
   *
   * @see https://www.gnu.org/software/bash/manual/bash.html#Tilde-Expansion
   * @see https://zsh.sourceforge.io/Doc/Release/Expansion.html#Filename-Expansion
   */
  readonly context?: "command-argument" | "assignment-value";
  /**
   * Whether to check literal text for filename generation. Defaults to
   * `true`, which covers possible Zsh pattern groups and glob qualifiers
   * even when the word's position is unknown.
   *
   * Set to `false` when the enclosing syntax suppresses filename
   * generation, as with heredoc bodies and heredoc delimiters. Escape decoding
   * is independent of this option. Represented expansions still produce uncertainty.
   *
   * An operand detached from inside a double-quoted parameter expansion loses
   * the enclosing quoting context. Resolving the detached operand can produce
   * text that differs from the shell's output. Pass the enclosing word to
   * observe the parameter expansion.
   */
  readonly filenameGeneration?: boolean;
}

/** Literal text determined without running any expansion. */
interface PartOk {
  readonly ok: true;
  readonly text: string;
}
/** A fragment that prevents a reliable whole-word text claim. */
interface PartFail {
  readonly ok: false;
  readonly reason: WordResolutionReason;
}
/** Internal resolution preserves the first reason text cannot be determined. */
type PartResult = PartOk | PartFail;

/**
 * Finds eligible tildes in assignment values and assignment-shaped arguments.
 * A nonzero offset skips a command operand's assignment prefix in the
 * first literal and permits a tilde immediately after the equals.
 *
 * Bash command arguments require an unquoted preceding colon and an unquoted
 * prefix through the end of the word or until an unquoted slash or colon.
 * Assignment values also allow Zsh's treatment of a backslash-escaped
 * preceding colon and a quoted or escaped slash. Adjacent literal parts
 * share the prefix state.
 */
function hasAssignmentValueTilde(
  parts: readonly Node[],
  firstPartOffset: number,
  requireUnquotedPrefix: boolean,
): boolean {
  let followsDelimiter = firstPartOffset > 0;
  let inTildePrefix = false;
  let i = firstPartOffset;
  for (const part of parts) {
    if (part.Type !== "Lit") {
      followsDelimiter = false;
      inTildePrefix = false;
      continue;
    }
    const raw = part.Value;
    if (typeof raw !== "string") {
      return false;
    }
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === "\\" && i + 1 < raw.length) {
        followsDelimiter = !requireUnquotedPrefix && raw[i + 1] === ":";
        inTildePrefix = false;
        i += 2;
        continue;
      }
      if (inTildePrefix && (ch === "/" || ch === ":")) {
        return true;
      }
      if (followsDelimiter && ch === "~") {
        if (!requireUnquotedPrefix) return true;
        inTildePrefix = true;
      }
      followsDelimiter = ch === ":";
      i += 1;
    }
    i = 0;
  }
  return inTildePrefix;
}

/** Identifies the scalar assignment prefix represented in the leading literal. */
function scalarAssignmentPrefix(first: Node | undefined): string | undefined {
  if (first?.Type === "Lit" && typeof first.Value === "string") {
    return /^[a-zA-Z_][a-zA-Z_0-9]*\+?=/.exec(first.Value)?.[0];
  }
  return undefined;
}

/**
 * True iff `parts` contains an unquoted bracket expression: an unescaped
 * `[` with a later unescaped `]` anywhere in the same word (POSIX 2.13.1 /
 * Bash Reference Manual §3.5.8.1, "Pattern Matching"). `a[bc` (no closing
 * bracket) is a *literal* filename in Bash; `a[bc]d` is a pattern. The
 * closing `]` may live in a different, concatenated `Lit` part than the
 * opening `[` (`decodeUnquotedLit`'s `brackets` output is concatenated,
 * in part order, across every top-level `Lit` part first) — and content
 * *between* the two, even if it came from an unquoted or quoted part, does
 * not prevent them from forming a bracket expression (`a["b"]` matches
 * real bash's file `ab`, verified empirically: quoting `"b"` doesn't
 * suppress the surrounding unquoted `[`/`]`). Only `Lit` parts contribute
 * to the scan — `SglQuoted`/`DblQuoted` text is fully quoted and never
 * glob-significant (`a'['bc']'d`'s brackets are both quoted, so it stays
 * literal).
 */
function hasUnquotedBracketExpression(parts: readonly Node[]): boolean {
  let brackets = "";
  for (const part of parts) {
    if (part.Type !== "Lit") {
      continue;
    }
    if (typeof part.Value !== "string") {
      return false;
    }
    brackets += decodeUnquotedLit(part.Value).brackets;
  }
  const openIndex = brackets.indexOf("[");
  if (openIndex === -1) {
    return false;
  }
  return brackets.includes("]", openIndex + 1);
}

/** Interprets one fragment within its quoting and filename-generation context. */
function resolvePart(
  part: Node,
  quoting: "unquoted" | "dblquoted" | "unknown",
  filenameGeneration = true,
): PartResult {
  switch (part.Type) {
    case "TypedNil":
      return { ok: false, reason: "unsupported" };
    case "Lit": {
      const raw = part.Value;
      if (typeof raw !== "string") {
        return { ok: false, reason: "unsupported" };
      }
      if (quoting === "dblquoted") {
        return { ok: true, text: decodeDblQuotedLit(raw) };
      }
      const { text, hasGlob } = decodeUnquotedLit(raw);
      if (filenameGeneration && hasGlob) {
        return { ok: false, reason: "glob" };
      }
      // A bare Lit can also come from a heredoc or quoted parameter operand,
      // where a backslash can survive unquoting.
      if (quoting === "unknown" && raw.includes("\\")) {
        return { ok: false, reason: "unsupported" };
      }
      return { ok: true, text };
    }
    case "SglQuoted": {
      const raw = part.Value;
      if (typeof raw !== "string") {
        return { ok: false, reason: "unsupported" };
      }
      // ANSI-C quoting ($'...') is flagged by SglQuoted.Dollar (mvdan/sh
      // v3.13.1's `syntax.SglQuoted.Dollar bool`); plain single-quoted
      // text ('...') never has any escapes interpreted at all.
      if (part.Dollar) {
        return decodeAnsiCString(raw);
      }
      return { ok: true, text: raw };
    }
    case "DblQuoted": {
      // Locale translation ($"...") is flagged by DblQuoted.Dollar
      // (mvdan/sh v3.13.1's `syntax.DblQuoted.Dollar bool`) and is checked
      // before descending into this node's children: the whole construct
      // is locale-dependent regardless of its contents (Bash Reference
      // Manual §3.1.2.5), so 'locale' deterministically takes precedence
      // over any 'expansion' (or other reason) its contents would
      // otherwise report — see WordResolutionReason's 'locale' doc.
      if (part.Dollar) {
        return { ok: false, reason: "locale" };
      }
      if (part.Parts?.includes(null)) {
        return { ok: false, reason: "unsupported" };
      }
      let text = "";
      for (const inner of nodeArray(part.Parts)) {
        const result = resolvePart(inner, "dblquoted");
        if (!result.ok) {
          return result;
        }
        text += result.text;
      }
      return { ok: true, text };
    }
    case "ParamExp":
    case "CmdSubst":
    case "ArithmExp":
    case "ProcSubst":
      return { ok: false, reason: "expansion" };
    case "ExtGlob":
      return { ok: false, reason: "glob" };
    case "BraceExp":
      // Caller-constructed or transformed records can already contain braces.
      return { ok: false, reason: "brace" };
    default:
      // Any word-part node type this module doesn't specifically know
      // about. "Unknowable" must stay a first-class result for well-formed
      // input rather than a thrown error — 'expansion' is the closest
      // neutral bucket (some run-time-dependent mechanism) until the type
      // is specifically handled.
      return { ok: false, reason: "expansion" };
  }
}

/**
 * Determines whether a `Word` node is statically a known string, and if
 * so, what that string is — the atom of shell-AST static analysis (e.g.
 * "is this word literally `rm`"). A word is static iff every part is a
 * literal after shell unquoting: a bare `Lit` (backslash escapes decoded
 * when the grammar position is known), a `SglQuoted` (including decoded
 * `$'...'` ANSI-C escapes),
 * or a `DblQuoted` containing only literal parts (and not itself a
 * `$"..."` locale translation) — including concatenations of these (`'r'm`
 * resolves to `"rm"`). A word containing any expansion (`ParamExp`,
 * `CmdSubst`, `ArithmExp`, `ProcSubst`), a triggering unquoted `~` (see
 * `options.context`), an unquoted glob metacharacter/bracket
 * expression/`ExtGlob`, potential brace expansion, a `$"..."` locale translation,
 * or a locale-dependent or unrepresentable ANSI-C escape has a nonstatic
 * resolution (see {@link WordResolution}). Failure to complete an observation is
 * separate: host-copy resource refusal and binding failures propagate explicitly
 * rather than becoming a word-resolution result.
 *
 * @param word - A `Word` node, e.g. `parseSync(...).Stmts[0].Cmd.Args[0]`.
 * @param options - See {@link ResolveWordOptions}.
 * @throws TypeError if `word.Type` is neither `"Word"` nor `"TypedNil"` — a programmer-error
 * misuse of the API, not an unknown dynamic word value.
 * @throws {@link ShAnalyzeResourceError} when the host exhausts its stack
 * while copying a brace-observation input. This is not a fixed syntax-depth
 * guarantee. Binding and unrelated host failures preserve their own categories.
 *
 * @public
 */
export function resolveWord(
  word: Node,
  options?: ResolveWordOptions,
): WordResolution {
  // A concrete nil pointer inside an interface retains its kind, but carries no text.
  if (word.Type === "TypedNil") {
    return { static: false, reason: "unsupported" };
  }
  if (word.Type !== "Word") {
    throw new TypeError(
      `resolveWord expects a "Word" node, got "${word.Type}"`,
    );
  }
  // A nil slice is an empty word; a nil element is a missing semantic fragment.
  // Omitting a fragment would invent a different command name.
  if (word.Parts?.includes(null)) {
    return { static: false, reason: "unsupported" };
  }
  const parts = nodeArray(word.Parts);
  if (parts.length === 0) {
    return { static: true, text: "" };
  }
  const braces = observeBraces(word);
  if (braces === "unsupported") {
    return { static: false, reason: "unsupported" };
  }
  if (braces) {
    return { static: false, reason: "brace" };
  }
  // `parts.length === 0` returned above, so `parts[0]` is a real element.
  const first = parts[0];
  if (
    first.Type === "Lit" &&
    typeof first.Value === "string" &&
    first.Value.startsWith("~")
  ) {
    return { static: false, reason: "tilde" };
  }
  const context = options?.context;
  const assignmentPrefix =
    context === "assignment-value" ? undefined : scalarAssignmentPrefix(first);
  if (
    (assignmentPrefix !== undefined || context !== "command-argument") &&
    hasAssignmentValueTilde(
      parts,
      assignmentPrefix?.length ?? 0,
      context === "command-argument",
    )
  ) {
    return { static: false, reason: "tilde" };
  }
  const filenameGeneration = options?.filenameGeneration !== false;
  if (filenameGeneration && hasUnquotedBracketExpression(parts)) {
    return { static: false, reason: "glob" };
  }
  const quoting = context === undefined ? "unknown" : "unquoted";
  let text = "";
  for (const part of parts) {
    const result = resolvePart(part, quoting, filenameGeneration);
    if (!result.ok) {
      return { static: false, reason: result.reason };
    }
    text += result.text;
  }
  return { static: true, text };
}

/**
 * Returns a fixed scalar assignment prefix when the operand is one shell
 * field. Bash treats tilde replacement as quoted, and ANSI-C quotes preserve
 * field boundaries even when a Unicode escape's encoding depends on locale.
 * Other parts must resolve as literals, with brace and pathname expansion
 * ruled out for the full word. Zsh glob qualifiers can remove the prefix
 * or the entire operand.
 *
 * @internal
 */
export function singleFieldAssignmentPrefix(
  word: Node | null | undefined,
): string | undefined {
  if (word?.Type !== "Word" || word.Parts?.includes(null)) return undefined;
  const parts = nodeArray(word.Parts);
  const prefix = scalarAssignmentPrefix(parts[0]);
  if (
    prefix === undefined ||
    observeBraces(word) !== false ||
    hasUnquotedBracketExpression(parts)
  ) {
    return undefined;
  }
  for (const part of parts) {
    const result = resolvePart(part, "unquoted");
    if (
      !result.ok &&
      !(part.Type === "SglQuoted" && part.Dollar && result.reason === "locale")
    ) {
      return undefined;
    }
  }
  return prefix;
}
