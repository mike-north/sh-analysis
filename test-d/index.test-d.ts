/** Declaration consumers receive analysis-owned observations over public faithful syntax types. */
import { expectType, expectError, expectAssignable } from "tsd";
import { LangZsh, parseSync } from "sh-ast";
import type { CallExpr, FlagsArithm, Word } from "sh-ast";
import * as analysis from "../dist/index.js";
import type {
  Argv0Resolution,
  CommandInventory,
  CommandSite,
  CommandUncertainty,
  WordResolution,
} from "../dist/index.js";

const file = parseSync("echo x", { Variant: LangZsh });
const inventory = analysis.enumerateCommands(file);
expectType<CommandInventory>(inventory);
expectType<CommandSite[]>(inventory.commands);
expectType<CommandUncertainty[]>(inventory.uncertainties);
expectType<CallExpr>(inventory.commands[0].node);
expectType<FlagsArithm>(inventory.uncertainties[0].node);
expectType<"opaque-zsh-subscript">(inventory.uncertainties[0].reason);
expectType<Argv0Resolution>(analysis.resolveArgv0(inventory.commands[0]));
expectType<WordResolution>(
  analysis.resolveWord({ Type: "Word", Parts: null } satisfies Word),
);
expectAssignable<Error>(new analysis.ShAnalyzeMaxDepthError(500));
expectType<"SH_ANALYSIS_MAX_DEPTH">(
  new analysis.ShAnalyzeMaxDepthError(500).code,
);
// Parsing remains a separate dependency, rather than a forwarded analysis API.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- tsd must receive this invalid public API call to assert its compile-time rejection.
expectError(analysis.parseSync("echo x"));
// The hard break returns a record; callers must explicitly examine its commands and uncertainty.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call -- tsd must receive this invalid public API call to assert its compile-time rejection.
expectError(analysis.enumerateCommands(file).map(() => 0));
// Analysis failure ownership is independent of the binding failure hierarchy.
expectError(analysis.ShAstError);
// Legacy assignment shorthand is absent from the independent package contract.
expectError(
  analysis.resolveArgv0(inventory.commands[0], {
    transparentWrappers: [{ names: ["retry"], skipAssignmentOperands: true }],
  }),
);

const copyCause = new RangeError("Maximum call stack size exceeded");
const copyRefusal = new analysis.ShAnalyzeResourceError(
  "brace-observation-copy",
  copyCause,
);
expectAssignable<analysis.ShAnalysisError>(copyRefusal);
expectType<"SH_ANALYSIS_RESOURCE">(copyRefusal.code);
expectType<"brace-observation-copy">(copyRefusal.operation);
expectType<RangeError>(copyRefusal.cause);
// Only the documented copy operation is part of this resource-refusal contract.
expectError(
  new analysis.ShAnalyzeResourceError("enumerate-commands", copyCause),
);
