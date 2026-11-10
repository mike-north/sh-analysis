# Separate executable identity from embedded-program uncertainty

Status: proposal, not yet implemented. The current `resolveArgv0` API is
unchanged; this describes a possible future model and needs a decision before
any work on a richer interpreter option model starts.

## Problem

`resolveArgv0` currently places two questions in `effective`: which executable
word a wrapper chain reaches, and whether that executable consumes another
program embedded in its arguments. For `bash -c 'echo x'`, the executable word
is known to be `bash`, while the embedded shell program is a distinct observation.
For `bash "$options" -c x`, the executable is still `bash`, but argument expansion
can change interpretation of the later selector. Returning static executable
text alone cannot establish absence of an embedded program.

The current `resolveArgv0` documents its overloaded result and known limits.
It must not be used as evidence of execution completeness, and its option
grammar is not being extended until these questions are resolved.

## Proposed model

Keep executable-word provenance separate from embedded-program observations:

- An executable observation records the source word, its index and resolution,
  together with the wrapper assumptions followed to reach it. This is syntax
  interpretation under those assumptions, not runtime command lookup.
- An embedded-program observation identifies the interpreter/wrapper assumption,
  selector and payload source words when known. Its state distinguishes observed,
  absent under a fully modeled option path, and unknown because an option or
  expansion can change interpretation.
- A known executable can coexist with unknown embedded-program interpretation.
  Neither observation changes a syntax record or reparses the embedded string.
- Missing operands, unmodeled options and expansion-sensitive positions remain
  explicit observations rather than fabricated command identities.

Examples for acceptance: `bash -c 'echo x'` has known executable bash and observed
embedded shell text; `bash script.sh` has known executable bash and no observed
`-c` program under the chosen model; `bash "$options" -c x` has known executable
bash and unknown option interpretation. `env -S 'bash -c x'` observes argument
splitting separately from the outer executable env; locating a further executable
requires a separately accepted argument-splitting model.

Open decisions: the public result names and collection shape; whether default
interpreter models are version/family assumptions; the completeness statement
per interpreter path; and whether recursive embedded-program parsing belongs in
a later composed service. No safety or lint decision belongs in this result.
