/** Analysis failures describe invalid interpretation configuration or refused work, never parser output. */

/** Independent base for analysis-owned failures, with stable machine-readable categories. @public */
export abstract class ShAnalysisError extends Error {
  /** Identifies the analysis contract that could not be completed. @public */
  abstract readonly code: string;
}

/**
 * Command-bearing nesting exceeded this analyzer's fixed structural budget.
 * Linear pipelines and Boolean chains do not consume additional nesting budget.
 * No partial command inventory is returned, so a refusal cannot resemble an empty inventory.
 * Callers decide how this affects their own policy.
 * @public
 */
export class ShAnalyzeMaxDepthError extends ShAnalysisError {
  /** Stable category for structural inventory refusal. @public */
  readonly code = "SH_ANALYSIS_MAX_DEPTH";
  /** Maximum supported genuinely nested command frames. @public */
  readonly maxDepth: number;
  /** Retain the violated budget without prescribing a caller's response. @public */
  constructor(maxDepth: number) {
    super(
      `enumerateCommands: exceeded maximum structural nesting depth (${String(maxDepth)} frames); no partial result is returned.`,
    );
    this.name = "ShAnalyzeMaxDepthError";
    this.maxDepth = maxDepth;
  }
}

/** Malformed wrapper/interpreter assumptions are configuration failures, not unknown shell values. @public */
export class ShAnalyzeInvalidWrapperSpecError extends ShAnalysisError {
  /** Stable category for rejected caller-supplied interpretation assumptions. @public */
  readonly code = "SH_ANALYSIS_INVALID_WRAPPER_SPEC";
  /** Describe the invalid assumption at its validation boundary. @public */
  constructor(message: string) {
    super(`resolveArgv0: invalid interpretation specification — ${message}`);
    this.name = "ShAnalyzeInvalidWrapperSpecError";
  }
}
