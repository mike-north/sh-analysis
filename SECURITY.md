# Security policy

`sh-analysis` reads shell scripts that may come from untrusted sources, so reports about it are
taken seriously.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub:

1. Go to the repository's [Security tab](https://github.com/mike-north/sh-analysis/security).
2. Choose **Report a vulnerability**.
3. Describe the problem, the affected version, and a minimal script or call that shows it.

You will get a reply in the advisory thread. Once a fix is released, the advisory is published
with credit to you unless you prefer otherwise.

## What counts

Examples of problems worth reporting privately:

- A result that claims a word or command is known (`static: true`) when the real shell would run
  something different, in a way a policy tool could be tricked by.
- A command that `enumerateCommands` silently omits, without an entry in `uncertainties`.
- Input that crashes the process, hangs, or exhausts memory instead of raising a documented error.

Parse failures and bugs in the parser itself usually belong to
[`sh-ast`](https://github.com/mike-north/sh-ast/security).

## Supported versions

The package is in the 0.x series. Fixes land in the latest release only.
