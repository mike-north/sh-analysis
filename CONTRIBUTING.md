# Contributing to sh-analysis

Thanks for helping. Bug reports, test cases from real scripts, and fixes are all welcome.

## Before you start

- Search the [issues](https://github.com/mike-north/sh-analysis/issues) first.
- For anything larger than a small fix, open an issue to agree on the approach.
- Security problems go through the private route in [SECURITY.md](SECURITY.md), not issues.
- Read the responsibilities in [AGENTS.md](AGENTS.md). In particular: this package never parses
  shell text itself (that is `sh-ast`'s job) and reports facts, not verdicts.

## Set up

You need Node.js 22 (see `.nvmrc`) and pnpm 11.12 (`corepack enable` picks up the version from
`package.json`).

```sh
git clone https://github.com/mike-north/sh-analysis.git
cd sh-analysis
pnpm install
pnpm build
pnpm check
pnpm test
```

All four must pass before you open a pull request.

- `pnpm check` runs type checking, type-aware ESLint, the API report check (API Extractor), Knip,
  syncpack, declaration tests and Prettier.
- `pnpm test` runs the package contract tests (`node --test`), the analysis tests (Vitest) and the
  declaration tests (tsd). The contract tests pack the package and install it in a fresh process.
- `pnpm fix:format` and `pnpm fix:lint-ts` fix formatting and auto-fixable lint problems.

## Writing tests

- Write the test first and watch it fail.
- Derive expected values by hand from the shell manuals (the Bash Reference Manual, POSIX, the Zsh
  manual) or from a real shell, never by copying the current output. Escape-decoding tests were
  checked against Bash 5.3 under `LC_ALL=C.UTF-8`.
- Add a regression test for every bug fix, and negative tests for inputs that must stay
  `static: false`.

## Code style

- TypeScript is strict. Explicit or implicit `any` and unsafe operations fail lint. An ESLint
  suppression must explain on the same line why it is needed.
- Comments explain what a module, type or function means and what it guarantees, not what the
  next line does.
- Defaults are documented, frozen data that callers can replace.

## Public API changes

The approved [API report](api-report/sh-analysis.api.md) and the
[generated API docs](docs/api/index.md) are committed. After an intentional API change:

```sh
pnpm build
pnpm build:docs
```

Review and commit both `api-report/` and `docs/api/`. CI runs API Extractor without `--local`, so
an unapproved API change fails.

## Changesets and versions

The package stays in the 0.x series. Any change that ships in the npm package (source, README,
LICENSE) needs a changeset:

```sh
pnpm exec changeset
```

Use `patch` for fixes and `minor` for new or breaking API. Never use `major`; CI rejects it. A
necessary API correction is a clean break, without deprecated aliases. Tooling-only changes need
no changeset.

## Pull requests

- Keep each pull request to one focused change.
- Describe what changed, why, and how you verified it. The [template](.github/pull_request_template.md)
  has the checklist.
- CI must pass, and every pull request needs an approving review before it can merge.
- Releases are published when the maintainer merges the automated "Version Packages" pull request. Contributions never
  publish.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
