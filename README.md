# sh-analysis

Shell word and command observations over the public `sh-ast` syntax model.
This package owns word resolution, command sites and contexts, wrapper chains
and interpreter-invocation observations. Consumers own lint policy and
presentation. Grammar and syntax remain owned by the selected Go implementation
and its faithful `sh-ast` binding.

Source metadata prepares the first stable `0.1.0` release. Publication remains an
owner action through the manual release workflow, which rejects placeholder and
prerelease versions. The required `sh-ast ^0.11.0` binding must be released and
the registry lockfile refreshed before this candidate is registry-installable;
local prospective package artifacts are integration evidence only.

```ts
import { parseSync } from "sh-ast";
import { enumerateCommands, resolveArgv0 } from "sh-analysis";

const inventory = enumerateCommands(parseSync('env A=1 printf "hello"'));
for (const site of inventory.commands) {
  const observation = resolveArgv0(site);
  // observation describes a command word under configurable wrapper assumptions.
}
// inventory.uncertainties records opaque syntax that can hide further execution.
```

`resolveWord` reports a known string or an explicit nonstatic reason. Analysis
never mutates the caller's syntax to observe braces. `enumerateCommands` retains
node identities and returns `{ commands, uncertainties }`; raw Zsh subscript
patterns produce `opaque-zsh-subscript` uncertainty. Static text and represented
command lists do not prove successful execution or execution completeness.
ANSI-C Unicode escapes claim static text only for non-NUL scalar values in a
UTF-8 shell locale. Surrogates, NUL and non-ASCII byte escapes remain unsupported;
ASCII byte escapes remain supported. No Latin-1 or arbitrary-locale byte-string
model is inferred. Wrapper/interpreter defaults are documented,
immutable and replaceable.

An observed stack-exhaustion failure while copying a brace-observation input throws
`ShAnalyzeResourceError` (`SH_ANALYSIS_RESOURCE`, operation `brace-observation-copy`)
with the original `RangeError` as its standard `cause`. This analysis-owned refusal
has no fixed syntax-depth threshold. It is distinct from command enumeration's
fixed depth budget; binding failures and unrelated host errors keep their identity.

Develop with Node22 and pnpm11.12: run `pnpm install`, `pnpm build`, `pnpm check`
and `pnpm test`. Tests cover independent errors, syntax identity, analysis meaning,
uncertainty, declarations and a real packed installation in a cold process.
Architecture and downstream cleanup are described in [design/ARCHITECTURE.md](design/ARCHITECTURE.md)
and [design/EXTRACTION-HANDOFF.md](design/EXTRACTION-HANDOFF.md).

Publication uses manual dispatch of `.github/workflows/release.yml` on main,
an exact prepared stable 0.x version, and npm trusted publishing without an
environment. The GitHub repository remains private. Ordinary validation has no
publication permission. No long-lived npm token is used.

Version and changelog preparation uses Changesets. Add a changeset with
`pnpm exec changeset` for package changes (tooling-only changes need none), then
run `pnpm version:prepare` and commit the resulting versions and `CHANGELOG.md`
before dispatching Release with the exact prepared version. Preparation never
publishes. Both CI and Release reject major changesets and public current or
planned versions outside 0.x. This project stays in the 0.x series until the owner
declares the shape stable; there is no override flag.
