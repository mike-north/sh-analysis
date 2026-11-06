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

TypeScript tooling covers all authored `.ts`, `.tsx`, `.mts`, and `.cts` files,
including tests and the TypeScript ESLint configuration. ESLint loads its config
through Jiti; Node runs all release scripts and tests with native type stripping,
explicitly enabled for compatibility with the declared Node 22.14 minimum.
`tsconfig.json` owns strict type checking for source, scripts, config, and tests;
`tsconfig.build.json` emits only package sources into `dist/`. Explicit and implicit
`any` and unsafe uses are rejected. An exceptional ESLint suppression must explain
on that same directive why the type is appropriate; unused suppressions fail lint.

After `pnpm build`, run `pnpm check` for types, type-aware ESLint, API report review,
Knip, and dependency consistency. Individual commands are `pnpm check:lint-ts`,
`pnpm check:api-report`, and `pnpm check:syncpack` (`syncpack lint`). Syncpack checks
the single package manifest while respecting its existing dependency ranges.

The package has a programmatic entry point even while its exports are empty.
[Generated API documentation](docs/api/index.md) and the approved
[API report](api-report/sh-analysis.api.md) are committed. Run `pnpm build` then
`pnpm build:docs` after an intentional public API change and review both outputs.
CI runs API Extractor without `--local`, so unapproved API changes fail instead of
rewriting the approved report. Generated intermediate models belong in `temp/`.
