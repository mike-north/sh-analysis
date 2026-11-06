# sh-analysis

Shell word and command observations over the public `sh-ast` syntax model.

This package owns word resolution, command sites and contexts, wrapper chains and
interpreter-invocation observations. Results describe facts, assumptions and uncertainty;
consumers own lint policy and presentation. Grammar and syntax remain owned by the Go
syntax implementation and `sh-ast` binding.

The repository is being established for extraction. Version `0.0.0-stage` reserves the
package identity and is deliberately rejected by the release workflow. No production
analysis API is advertised by this bootstrap.

Develop with Node 22 and pnpm 11.12: run `pnpm install`, `pnpm build`, `pnpm check`,
and `pnpm test`. Publication uses manual dispatch of `.github/workflows/release.yml`
on main, an exact prepared 0.x version and npm trusted publishing without an environment.
The GitHub repository remains private.
