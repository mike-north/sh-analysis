/**
 * Shell word and invocation observations over public sh-ast syntax records.
 * This package owns interpretation and uncertainty; parsing, syntax records and
 * printing belong to sh-ast, while callers own diagnostics, execution and policy.
 */
export { resolveWord } from "./resolve-word.js";
export type {
  ResolveWordOptions,
  WordResolution,
  WordResolutionReason,
} from "./resolve-word.js";
export { enumerateCommands } from "./enumerate-commands.js";
export type {
  CommandContext,
  CommandSite,
  CommandInventory,
  CommandUncertainty,
} from "./enumerate-commands.js";
export {
  DEFAULT_EMBEDDED_COMMAND_INTERPRETERS,
  DEFAULT_TRANSPARENT_WRAPPERS,
  resolveArgv0,
} from "./resolve-argv0.js";
export type {
  Argv0ChainWord,
  Argv0Resolution,
  Argv0UnresolvedReason,
  Argv0UnresolvedWord,
  EmbeddedCommandInterpreterSpec,
  ResolveArgv0Options,
  WrapperSpec,
} from "./resolve-argv0.js";
export {
  ShAnalysisError,
  ShAnalyzeInvalidWrapperSpecError,
  ShAnalyzeMaxDepthError,
  ShAnalyzeResourceError,
} from "./errors.js";
