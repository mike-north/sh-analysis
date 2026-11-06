/** Brace meaning is observed through public Go syntax operations, without changing caller records. */
import { InputError, splitBraces } from "sh-ast";
import type { Word } from "sh-ast";

/** Potential expansion is distinct from inability to trust escape or input interpretation. @internal */
export type BraceObservation = boolean | "unsupported";

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
  const observed = structuredClone(word);
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
