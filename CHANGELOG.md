# sh-analysis

## 0.1.1

### Patch Changes

- [#6](https://github.com/mike-north/sh-analysis/pull/6) [`6252252`](https://github.com/mike-north/sh-analysis/commit/62522526d631cb1872f8dbaeda4e34695bb98180) Thanks [@mike-north](https://github.com/mike-north)! - Rewrite the README for users: what the package does, how to install it, a quickstart with real output, one section per task, and the limits of what it can know. Add package keywords, homepage and issue tracker links.

## 0.1.0

### Minor Changes

- Initial release. Facts about shell scripts from the [sh-ast](https://github.com/mike-north/sh-ast) syntax tree, with explicit uncertainty:
  - `resolveWord` resolves a word to its literal text, or reports why it cannot (`expansion`, `tilde`, `glob`, `brace`, `locale`, `unsupported`).
  - `enumerateCommands` lists every command site in a script, with its context and the uncertainty about whether it runs.
  - `resolveArgv0` sees through transparent wrappers (`sudo`, `env`, `nice`, ...) to the command that actually runs. `DEFAULT_TRANSPARENT_WRAPPERS` and `DEFAULT_EMBEDDED_COMMAND_INTERPRETERS` describe the built-in tables, which `WrapperSpec` and `EmbeddedCommandInterpreterSpec` let callers extend.
  - Failures are typed: `ShAnalysisError`, `ShAnalyzeMaxDepthError`, `ShAnalyzeResourceError` and `ShAnalyzeInvalidWrapperSpecError`.
