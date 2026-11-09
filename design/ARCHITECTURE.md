# Analysis responsibilities

`sh-analysis` is an independent consumer of the faithful public `sh-ast` syntax
API. It interprets words, command sites and contexts, configured transparent
wrappers, and shell interpreter option observations. Parsing, validation, syntax
records, byte positions, traversal semantics and printing remain owned by the
selected Go syntax implementation and its TypeScript/WASM binding. ESLint
adapters own source-coordinate projections, diagnostics, policy and fixes.

The dependency direction is `sh-analysis` → `sh-ast`. There are no private
cross-package imports and no analysis dependency from the syntax binding.
Consumers import syntax types, constants and parser operations from `sh-ast`
and observations from `sh-analysis`; this package does not forward the syntax
package's API.

## Observation meaning

`resolveWord` describes one exact literal string only when the known syntax and
stated context support that claim. Dynamic expansions, filesystem-dependent
patterns, locale translation, possible brace expansion and unsupported byte or
escape cases remain first-class nonstatic results. ANSI-C Unicode escapes claim
text only for non-NUL scalar values in a UTF-8 shell locale; isolated surrogate
escapes and two separate surrogate escapes remain unsupported rather than
fabricated Unicode text. Byte-oriented escapes support non-NUL ASCII only.
Non-ASCII byte runs conservatively remain unsupported, including runs that could
form UTF-8; no Latin-1 mapping or arbitrary-locale byte-string model is assumed. A bare Word supplies neither
dialect nor shell option state, so potential expansion is a conservative
observation rather than a claim about a particular execution environment.

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

Analysis-owned configuration and resource refusals derive from `ShAnalysisError`.
They do not derive from binding/parser errors. `ShAnalyzeResourceError` identifies
observed host stack exhaustion at `brace-observation-copy`, preserving the original
`RangeError` as the standard cause. This copy boundary has no fixed syntax-depth
policy; unrelated copy errors and binding failures propagate unchanged. Enumeration's
`ShAnalyzeMaxDepthError` separately describes its fixed command-structure budget.
Resource refusal returns no silently truncated observation or inventory; the consumer
decides how to respond.

## Release and validation

The repository is private. Publication is a deliberate manual main-branch
workflow using npm trusted publishing, an exact prepared stable 0.x version,
and no GitHub environment. Bootstrap placeholder versions are rejected.
No automatic push/PR publication exists. Node22 is the development runtime;
Node24/npm11.21.1 is the publishing runtime.

Behavior tests assert shell/manual-derived outcomes, not implementation snapshots.
Boundary tests cover independent errors, source identity and nonmutation.
Packaged smoke and declaration tests exercise the exported package surface.
The extracted candidate must also be composed with the exact selected syntax
binding and exercised by the real ESLint consumer before acceptance.
