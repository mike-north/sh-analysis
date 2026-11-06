# Project responsibilities

`sh-analysis` interprets words, commands, command contexts, wrapper chains and interpreter
invocations over public `sh-ast` APIs. Report facts, explicit assumptions and uncertainty.
Defaults must be documented and overridable; caller policy, diagnostics and fixes belong
to consumers. Grammar, parser/printer changes and syntax records belong to the selected
Go implementation and its faithful `sh-ast` binding. Never import private WASM/codec
internals or introduce another shell grammar here.

Write intended-outcome tests before software changes. Document durable semantic intent
in modules, types, constants and operations, including responsibilities and invariants.
Keep temporary progress in WORK_RECORD.md. Necessary API corrections are hard breaks,
without migration aliases. Keep versions below 1.0. Development uses Node 22 and pnpm
11.12; build, check and test must pass before pushes. Commit as Mike North
<michael.l.north@gmail.com>, without AI attribution or skipped hooks.

Stop at reviewable pull requests: the orchestrator owns acceptance and merges. Release
only through the manual GitHub Actions release workflow using npm trusted publishing.
Never run an actual publish during implementation. Do not add long-lived npm tokens.
