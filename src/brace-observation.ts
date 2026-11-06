/** Brace meaning is observed through public Go syntax operations, without changing caller records. */
import { InputError, splitBraces } from "sh-ast";
import type { Word } from "sh-ast";
import { ShAnalyzeResourceError } from "./errors.js";

/** Potential expansion is distinct from inability to trust escape or input interpretation. @internal */
export type BraceObservation = boolean | "unsupported";

/** Exact observed V8 stack refusal; other RangeError messages are not this known copy failure. */
const COPY_STACK_EXHAUSTION_MESSAGE = "Maximum call stack size exceeded";

/**
 * Isolate caller records using the host clone operation. Only its observed stack
 * exhaustion is adapted here; binding failures and unrelated clone exceptions
 * retain their own identity. No syntax-depth or schema policy is inferred.
 */
function copyWordForBraceObservation(word: Word): Word {
  try {
    return structuredClone(word);
  } catch (error) {
    if (
      error instanceof RangeError &&
      error.message === COPY_STACK_EXHAUSTION_MESSAGE
    ) {
      throw new ShAnalyzeResourceError("brace-observation-copy", error);
    }
    throw error;
  }
}

/**
 * Exclude protected openings locally, then let Go own brace grammar on an isolated copy.
 * Escape discrepancies remain uncertainty; this module never reparses brace syntax itself.
 * Current content is observed each time so edits cannot be hidden by an identity cache.
 * @internal
 */
export function observeBraces(word: Word): BraceObservation {
  let candidate = false;
  let escaped = false;
  let escapeCrossesPart = false;
  let protectedNext = false;
  for (const part of word.Parts ?? []) {
    escapeCrossesPart ||= protectedNext;
    if (part?.Type !== "Lit" || typeof part.Value !== "string") {
      protectedNext = false;
      continue;
    }
    for (const character of part.Value) {
      if (protectedNext) {
        protectedNext = false;
      } else if (character === "\\") {
        protectedNext = true;
        escaped = true;
      } else if (character === "{") {
        candidate = true;
      }
    }
  }
  if (escapeCrossesPart) {
    return "unsupported";
  }
  if (!candidate) {
    return false;
  }
  if (escaped) {
    return "unsupported";
  }
  const observed = copyWordForBraceObservation(word);
  try {
    splitBraces(observed);
  } catch (error) {
    if (error instanceof InputError) {
      return "unsupported";
    }
    throw error;
  }
  // SplitBraces' boolean reports processing, not necessarily a resulting BraceExp.
  return observed.Parts?.some((part) => part?.Type === "BraceExp") ?? false;
}
