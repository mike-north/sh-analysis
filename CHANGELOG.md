# sh-analysis

## 0.1.0

### Minor Changes

- Initial release. Facts about shell scripts from the [sh-ast](https://github.com/mike-north/sh-ast) syntax tree, with explicit uncertainty:
  - `resolveWord` resolves a word to its literal text, or reports why it cannot (`expansion`, `tilde`, `glob`, `brace`, `locale`, `unsupported`).
  - `enumerateCommands` lists every command site in a script, with its context and the uncertainty about whether it runs.
  - `resolveArgv0` sees through transparent wrappers (`sudo`, `env`, `nice`, ...) to the command that actually runs. `DEFAULT_TRANSPARENT_WRAPPERS` and `DEFAULT_EMBEDDED_COMMAND_INTERPRETERS` describe the built-in tables, which `WrapperSpec` and `EmbeddedCommandInterpreterSpec` let callers extend.
  - Failures are typed: `ShAnalysisError`, `ShAnalyzeMaxDepthError`, `ShAnalyzeResourceError` and `ShAnalyzeInvalidWrapperSpecError`.
