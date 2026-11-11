# Architecture

`sh-analysis` is an independent consumer of the public `sh-ast` syntax API. It
interprets words, command sites and contexts, configured transparent wrappers,
and shell interpreter option observations. Parsing, validation, syntax records,
byte positions, traversal semantics and printing belong to the Go syntax
implementation (a maintained fork of mvdan/sh) and its TypeScript/WASM binding,
`sh-ast`. Consumers such as linters own source-coordinate projections,
diagnostics, policy and fixes.

The dependency direction is `sh-analysis` → `sh-ast`. There are no private
cross-package imports and no dependency from the syntax binding on this package.
Consumers import syntax types, constants and parser operations from `sh-ast`
and observations from `sh-analysis`; this package does not forward the syntax
package's API. The runtime dependency is `sh-ast ^0.11.0`, the first binding
release that exposes the public `splitBraces` operation used below.

## Observation meaning

`resolveWord` describes one exact literal string only when the known syntax and
stated context support that claim. Dynamic expansions, filesystem-dependent
patterns, locale translation, possible brace expansion and unsupported byte or
escape cases remain first-class nonstatic results. ANSI-C Unicode escapes claim
text only for non-NUL scalar values in a UTF-8 shell locale; isolated surrogate
escapes and two separate surrogate escapes remain unsupported rather than
fabricated Unicode text. Byte-oriented escapes support non-NUL ASCII only.
Non-ASCII byte runs conservatively remain unsupported, including runs that could
form UTF-8; no Latin-1 mapping or arbitrary-locale byte-string model is assumed.
A bare Word supplies neither dialect nor shell option state, so potential
expansion is a conservative observation rather than a claim about a particular
execution environment.

Command sites retain the caller's syntax node identities and argument indices.
Contexts describe how syntax reaches a command; they do not determine whether
execution will occur. Wrapper and interpreter defaults are deeply immutable,
documented assumptions that callers can replace. A resolved name does not prove
installation, runtime dispatch, successful execution, safety or permission.

Go owns brace recognition. Analysis calls public `splitBraces` on an isolated
copy and inspects whether the result contains a BraceExp. The operation's bool
is not itself an expansion fact. Caller syntax and positions stay unchanged.
Escape discrepancies are reported as unsupported rather than repaired with a
second brace grammar.

## Command inventory

`enumerateCommands(root)` returns a `CommandInventory`:

```ts
const inventory = enumerateCommands(file);
for (const site of inventory.commands) {
  // Command-node identity, argument indices and context are retained.
}
for (const uncertainty of inventory.uncertainties) {
  // The consumer decides how incomplete interpretation affects its own policy.
}
```

The only uncertainty reason today is `opaque-zsh-subscript`. It retains the
original `FlagsArithm` node and its surrounding command context. Detection
follows the Go parser's raw-pattern representation (a literal-only Word), never a
second Zsh grammar or a scan of raw strings for command-looking text. Explicitly
represented expansion and arithmetic children continue to be traversed. A command
list alone is not evidence that opaque syntax cannot run further commands.

## Wrapper and interpreter assumptions

Wrapper tables use `assignmentOperands: 'shell-identifier' | 'env' | 'sudo'` to
declare how a wrapper's `NAME=value` operands are recognized. There is no
boolean shorthand: a table that still supplies the removed
`skipAssignmentOperands` field is rejected with
`ShAnalyzeInvalidWrapperSpecError` before any matching, as are malformed tables.

`resolveArgv0`'s `effective` result currently combines two questions: which
executable word a wrapper chain reaches, and whether that executable runs a
program embedded in its arguments. See
[INTERPRETER-OBSERVATIONS-PROPOSAL.md](INTERPRETER-OBSERVATIONS-PROPOSAL.md)
before extending that model. Static text alone does not establish execution
completeness.

## Errors

Analysis-owned configuration and resource refusals derive from `ShAnalysisError`.
They do not derive from binding or parser errors. `ShAnalyzeResourceError`
identifies observed host stack exhaustion at `brace-observation-copy`, preserving
the original `RangeError` as the standard cause. This copy boundary has no fixed
syntax-depth policy; unrelated copy errors and binding failures propagate
unchanged. Enumeration's `ShAnalyzeMaxDepthError` separately describes its fixed
command-structure budget. A refusal never returns a silently truncated
observation or inventory; the consumer decides how to respond.

## Release and validation

Publication happens only when a Changesets "Version Packages" pull request is
merged to `main`, using npm trusted publishing registered against the
`release.yml` workflow with no GitHub environment. Placeholder and non-0.x
versions are rejected. Pull requests never publish. Node 22 is the development
runtime; Node 24 with npm 11.21.1 is the publishing runtime.

Behavior tests assert outcomes derived from the shell manuals and from a real
shell (Bash 5.3 under `LC_ALL=C.UTF-8` for escape decoding), not implementation
snapshots. Boundary tests cover independent errors, source identity and
nonmutation. Packaged smoke and declaration tests exercise the exported package
surface from a real packed install in a fresh process.
