# sh-analysis

## 0.2.0

### Minor Changes

- [#17](https://github.com/mike-north/sh-analysis/pull/17) [`9db9ade`](https://github.com/mike-north/sh-analysis/commit/9db9ade8b9522abd57a0fbcc6f9902872842baa6) Thanks [@mike-north](https://github.com/mike-north)! - Analyze long arithmetic chains inside command arguments using sh-ast 0.12.

## 0.1.3

### Patch Changes

- [#13](https://github.com/mike-north/sh-analysis/pull/13) [`6e9ed64`](https://github.com/mike-north/sh-analysis/commit/6e9ed64de3e6c88ae4b55d7f3cedf724c2bd4d23) Thanks [@mike-north](https://github.com/mike-north)! - Analyse very long flat arithmetic expressions, test conditions and `elif` chains without exhausting the call stack. `enumerateCommands` previously threw a `RangeError` on an arithmetic expression, `[[ ... ]]` condition or subscript with several thousand terms; it now reports the commands and uncertainties inside it like any other, and the result and its order are unchanged.

## 0.1.2

### Patch Changes

- [#9](https://github.com/mike-north/sh-analysis/pull/9) [`ba16862`](https://github.com/mike-north/sh-analysis/commit/ba1686241e6be35ddefd4da9d1538daadd91c13c) Thanks [@mike-north](https://github.com/mike-north)! - Require Node.js 22.14 or later on the 22 line, or Node.js 24 or later.

## 0.1.1

### Patch Changes

- [#6](https://github.com/mike-north/sh-analysis/pull/6) [`faefaed`](https://github.com/mike-north/sh-analysis/commit/faefaedf2ae875c5040dc6f14e199ddf7c040106) Thanks [@mike-north](https://github.com/mike-north)! - Rewrite the README for users: what the package does, how to install it, a quickstart with real output, one section per task, and the limits of what it can know. Add package keywords, homepage and issue tracker links.

## 0.1.0

### Minor Changes

- Initial release. Facts about shell scripts from the [sh-ast](https://github.com/mike-north/sh-ast) syntax tree, with explicit uncertainty:
  - `resolveWord` resolves a word to its literal text, or reports why it cannot (`expansion`, `tilde`, `glob`, `brace`, `locale`, `unsupported`).
  - `enumerateCommands` lists every command site in a script, with its context and the uncertainty about whether it runs.
  - `resolveArgv0` sees through transparent wrappers (`sudo`, `env`, `nice`, ...) to the command that actually runs. `DEFAULT_TRANSPARENT_WRAPPERS` and `DEFAULT_EMBEDDED_COMMAND_INTERPRETERS` describe the built-in tables, which `WrapperSpec` and `EmbeddedCommandInterpreterSpec` let callers extend.
  - Failures are typed: `ShAnalysisError`, `ShAnalyzeMaxDepthError`, `ShAnalyzeResourceError` and `ShAnalyzeInvalidWrapperSpecError`.
