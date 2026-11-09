# Extraction handoff

This repository owns the extracted analysis source originally inspected at
sh-ast `43390d3fc048e6a1c524d34579182c0010df99dc`. It changes the ownership and
command inventory contract deliberately; it supplies no migration aliases.

## Binding cleanup

The binding owner removes `src/analyze`, the `./analyze` export, syntax-root
analysis exception exports and analysis-only tests/API documentation. The
independent analysis error base is `ShAnalysisError`; concrete depth/configuration
errors have `SH_ANALYSIS_*` codes and do not derive from `ShAstError`.
`ShAnalyzeResourceError` adds `code: 'SH_ANALYSIS_RESOURCE'`, operation
`'brace-observation-copy'`, and the original observed stack-exhaustion `RangeError`
as standard `cause`. Consumers should preserve that error rather than turn it
into a successful/empty result. This is a host-copy refusal, not enumeration's
fixed depth budget or a duplicate binding depth policy. Unrelated host failures
and public binding failures retain their original identity.

Remove the old private `word-braces` analysis bridge operation. Public synchronous
`splitBraces(word: Word): boolean` remains solely as faithful syntax behavior.
The binding must build and load without `sh-analysis` or ESLint dependencies.

Go source changes remain in the maintained fork. The selected fork revision is
`bbc7c4ace575d5de375726fdaa2a5c001c46564c`; release evidence must identify the exact
binding source revision and canonical Linux WASM artifact used for composition.

## Consumer imports and command inventory

Import parser operations, syntax records/types and constants directly from
`sh-ast`; import analysis functions/types/errors from `sh-analysis`. Remove old
syntax/analyze forwarding exports from ESLint adapters.

`enumerateCommands(root)` now returns `CommandInventory`:

```ts
const inventory = enumerateCommands(file);
for (const site of inventory.commands) {
  // Existing command-node identity, argument indices and context are retained.
}
for (const uncertainty of inventory.uncertainties) {
  // The consumer decides how incomplete interpretation affects its own policy.
}
```

The initial uncertainty reason is `opaque-zsh-subscript`. It retains the original
`FlagsArithm` node and its surrounding command context. Detection follows the
selected Go raw-pattern representation (literal-only Word X), never a second Zsh
grammar or scanning raw strings for command-looking text. Explicit represented
expansion/arithmetic children continue to be traversed. A command list alone is
not evidence that opaque syntax cannot execute further commands.

Wrapper configurations use `assignmentOperands: 'shell-identifier' | 'env' | 'sudo'`
when assignment operands are intended. The redundant legacy
`skipAssignmentOperands` boolean is removed, not forwarded; JavaScript inputs
containing it are rejected clearly. Update any ESLint wrapper tables to the
explicit grammar.

ANSI-C interpretation now declines non-scalar Unicode escapes, non-ASCII
byte-oriented escapes and NUL-producing escapes rather than claiming false exact
text. Non-NUL scalar Unicode escapes assume UTF-8; ASCII byte escapes are supported.
Two surrogate escapes do not become one scalar, and byte runs are not decoded
through an invented Latin-1 or locale model.

`resolveArgv0` retains its documented extraction candidate behavior. Its `effective`
result currently combines executable and embedded-program interpretation; see the
separate proposal before expanding that model. Static text alone does not establish
execution completeness.

## Release gate

The analysis runtime dependency is `sh-ast ^0.11.0`, because earlier published
binding versions do not expose the selected public brace operation or Go source.
Local prospective artifacts support integration evidence only. The draft extraction
cannot be accepted as registry-installable until the actual binding release exists
and the ordinary lockfile has been refreshed against it. No prospective local
metadata rewrite is an npm publication or release claim.

Root owns final review, consumer composition, acceptance and merges. This extraction
writer does not remove files from the binding or change ESLint in its checkout.
