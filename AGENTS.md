# Project responsibilities

`sh-analysis` interprets words, commands, command contexts, wrapper chains and interpreter
invocations over public `sh-ast` APIs. Report facts, explicit assumptions and uncertainty.
Defaults must be documented and overridable; caller policy, diagnostics and fixes belong
to consumers. Grammar, parser/printer changes and syntax records belong to the selected
Go implementation and its faithful `sh-ast` binding. Never import private WASM/codec
internals or introduce another shell grammar here.

Write intended-outcome tests before software changes. Document durable semantic intent
in modules, types, constants and operations, including responsibilities and invariants.
Necessary API corrections are hard breaks,
without migration aliases. Keep versions below 1.0. Development uses Node 22 and pnpm
11.12; build, check and test must pass before pushes. Commit as Mike North
<michael.l.north@gmail.com>, without AI attribution or skipped hooks.

Release
only through the manual GitHub Actions release workflow using npm trusted publishing.
Never run an actual publish during implementation. Do not add long-lived npm tokens.

## Responsibilities across the ecosystem

This repository is one layer of a five-layer system. Each layer owns one concern; work that belongs to another layer goes there, even when it would be quicker to do it here.

| Layer | Owns | Must not do |
|---|---|---|
| **sh-ast** | Shell syntax: a faithful TypeScript binding, via WASM, of the maintained Go fork of mvdan/sh (mike-north/sh). The grammar itself lives in that fork; sh-ast owns the binding, the AST and its types, positions, traversal, printing. Grammar or lexer changes go to the fork and arrive here through the binding. | Interpret words, resolve commands, track working directories, or express any policy. Reimplement any part of the grammar in TypeScript. |
| **sh-analysis** | Observations over sh-ast syntax: word resolution, command sites and argv0, wrapper chains (sudo, env, command, xargs and the like), interpreter invocations, working-directory and path facts, each with explicit uncertainty. Facts only. | Parse shell itself, decide what is allowed, format diagnostics, or know about ESLint, hosts, or agents. |
| **eslint-sh** | Lint policy for shell files on disk: the ESLint language, rules, presets, fixes, and the projection of sh-analysis facts into diagnostics. | Intercept commands at run time, reimplement word or command resolution, or approve tools. |
| **command-steering** | Invocation-time steering of an agent's shell commands: the rule schema (matcher and action), the engine, host adapters, the daemon and shell shim, decision logs. Consumes sh-ast and sh-analysis for canonicalization. Owns the rule format that other layers register into. | Build, vet, or approve tools; act as a sandbox or permission system; reimplement parsing or analysis. |
| **toolsmith** | The lifecycle of agent-proposed narrow tools: proposal, feedback during proposal, staging, human approval, the registry, revocation. Registers rule instances into command-steering's format and consumes eslint-sh for proposal analysis. | Match or steer commands at invocation time; define its own rule or matcher format. |

Signs an implementation has strayed, each a reason to stop and move the work:

- A shell lexer, tokenizer, or heredoc handling written in TypeScript anywhere (grammar changes belong in the Go fork that sh-ast binds).
- sh-analysis code that returns a verdict, a severity, or advice instead of a fact.
- eslint-sh code that reads hook payloads, sockets, or live commands.
- command-steering code that stages, hashes, or approves a tool, or that inspects words by regex instead of asking sh-analysis.
- toolsmith code that decides what to do with a command an agent is about to run.

When a needed capability sits in another layer and does not exist yet, add it there (or record the gap in that repository) rather than approximating it here.

## Syntax boundary clarification

The prohibition on TypeScript lexing, tokenizing and heredoc handling targets reimplementing
grammar: scanning source text to decide where tokens, words or heredoc bodies begin and end.
A guard that derives every position from sh-ast nodes (for example, checking that the text at
the end of a `Redirect.Hdoc` range is the redirect's delimiter before shortening an edit) is
consumption of the binding, not reimplementation, and is allowed. When such a guard exists
only because the binding's positions are imprecise, that imprecision is a sh-ast (or Go fork)
defect to report and fix upstream, so the guard can eventually be deleted.

Command and dependency harvesting (enumerating command sites, argv0, wrappers, what a script
invokes) is sh-analysis's responsibility. Design documents in eslint-sh that assign it to
`ast-services` predate the split; they describe extraction debt, not a competing boundary.
