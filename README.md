# sh-analysis

Find every program a shell script runs, even behind `sudo`, `env` or `nice`, and know exactly
when the answer is "can't tell", such as a command hidden in a variable or inside `bash -c '…'`.
`sh-analysis` reads the syntax tree from [`sh-ast`](https://github.com/mike-north/sh-ast) and
gives you facts about it: what each word resolves to, every command site and how it is reached,
the wrapper chain in front of a command, and whether an interpreter runs an embedded program.
When a value depends on run time, you get a reason (`expansion`, `glob`, `tilde`, …) instead of
a guess.

It is for people who build linters, policy checkers and dependency harvesters for shell scripts.
Regex scanning misses `$(...)` and pipelines and is fooled by quoting; this works on the real
parse tree and never invents text it cannot know. Requires Node.js 22.14+; ESM, types included.

```sh
npm install sh-analysis sh-ast
```

```js
import { parseSync } from "sh-ast";
import { enumerateCommands, resolveArgv0 } from "sh-analysis";

const script = `
sudo -u deploy env NODE_ENV=production node server.js
curl -fsSL https://example.com/install.sh | sh
"$EDITOR" notes.txt
`;

for (const site of enumerateCommands(parseSync(script)).commands) {
  const { effective } = resolveArgv0(site);
  console.log(
    effective.static ? effective.text : `unknown (${effective.reason})`,
  );
}
```

```text
node
curl
sh
unknown (expansion)
```

## Install

```sh
npm install sh-analysis sh-ast
```

You parse with `sh-ast` and analyse with `sh-analysis`, so install both. `sh-analysis` depends on
`sh-ast` `^0.11.0`.

## Requirements

- Node.js 22.14 or newer.
- ESM only (`import`, not `require`).
- TypeScript types are included.
- Shell dialects are whatever `sh-ast` parses: Bash (the default), POSIX sh, mksh, Bats and Zsh.

## What you can do

### Resolve a word to its literal text

`resolveWord` tells you the exact string a word stands for, or why it can't. Every command site
from `enumerateCommands` already carries `argv`, the resolution of each argument.

```js
import { parseSync, printSync } from "sh-ast";
import { enumerateCommands } from "sh-analysis";

const [site] = enumerateCommands(
  parseSync(`echo "hello "'world' $'tab\\there' ~/notes *.log {a,b} "$USER"`),
).commands;

site.node.Args.forEach((word, i) => {
  console.log(printSync(word).padEnd(18), JSON.stringify(site.argv[i]));
});
```

```text
echo               {"static":true,"text":"echo"}
"hello "'world'    {"static":true,"text":"hello world"}
$'tab\there'       {"static":true,"text":"tab\there"}
~/notes            {"static":false,"reason":"tilde"}
*.log              {"static":false,"reason":"glob"}
{a,b}              {"static":false,"reason":"brace"}
"$USER"            {"static":false,"reason":"expansion"}
```

Quotes and escapes are removed for you. You can also call `resolveWord(word)` on any `Word` node
yourself; pass `{ context: "assignment-value" }` when the word is the value of `NAME=value`, where
`~` after `:` also expands.

### List every command and how it is reached

`enumerateCommands` walks the whole tree, including command substitutions, process substitutions,
redirection targets, functions, loops and conditionals. Each site has the `CallExpr` node, its
resolved words and a `context` path from the outermost construct inwards.

```js
import { parseSync } from "sh-ast";
import { enumerateCommands } from "sh-analysis";

const script = `
if grep -q main .git/HEAD; then
  make build && ./deploy.sh &
fi
echo "built at $(date)" | tee build.log
`;

for (const site of enumerateCommands(parseSync(script)).commands) {
  const name = site.argv0.static ? site.argv0.text : `<${site.argv0.reason}>`;
  console.log(name.padEnd(12), JSON.stringify(site.context));
}
```

```text
grep         [{"kind":"if","branch":"cond"}]
make         [{"kind":"if","branch":"then"},{"kind":"background"}]
./deploy.sh  [{"kind":"if","branch":"then"},{"kind":"background"},{"kind":"and","side":"right"}]
echo         [{"kind":"pipeline","stage":0}]
date         [{"kind":"pipeline","stage":0},{"kind":"cmdSubst"}]
tee          [{"kind":"pipeline","stage":1}]
```

The nodes are the ones you passed in, so you can report positions with `sh-ast`'s `nodePos` and
`nodeEnd`.

### See through wrappers

`resolveArgv0` follows transparent wrappers, skipping their flags, operands and `NAME=value`
assignments, and returns the whole chain. `chainIndices` points at each chain word in `argv`.

```js
import { parseSync } from "sh-ast";
import { enumerateCommands, resolveArgv0 } from "sh-analysis";

const [site] = enumerateCommands(
  parseSync("sudo -u deploy env -i PATH=/usr/bin nice -n 5 make release"),
).commands;

console.log(resolveArgv0(site));
```

```text
{
  chain: [
    { static: true, text: 'sudo' },
    { static: true, text: 'env' },
    { static: true, text: 'nice' },
    { static: true, text: 'make' }
  ],
  chainIndices: [ 0, 3, 6, 9 ],
  effective: { static: true, text: 'make' },
  assignmentsSkipped: 0
}
```

`assignmentsSkipped` counts shell assignments in front of the command itself (`FOO=1 make`), not
a wrapper's own operands such as `env PATH=…`.

The default wrappers are `command`, `exec`, `env`, `nohup`, `nice`, `time`, `timeout` and `sudo`
(`DEFAULT_TRANSPARENT_WRAPPERS`). They are plain, frozen data. Pass your own table to add a
wrapper or to drop one:

```js
import { parseSync } from "sh-ast";
import {
  DEFAULT_TRANSPARENT_WRAPPERS,
  enumerateCommands,
  resolveArgv0,
} from "sh-analysis";

const site = enumerateCommands(
  parseSync("find . -name '*.tmp' -print0 | xargs -0 -n 10 rm -f"),
).commands[1];

console.log(resolveArgv0(site).effective);

const xargs = {
  names: ["xargs"],
  noArgFlags: ["-0", "-r", "-t"],
  argFlags: ["-n", "-P", "-I"],
};
console.log(
  resolveArgv0(site, {
    transparentWrappers: [...DEFAULT_TRANSPARENT_WRAPPERS, xargs],
  }).effective,
);
```

```text
{ static: true, text: 'xargs' }
{ static: true, text: 'rm' }
```

An empty table (`transparentWrappers: []`) turns wrapper following off.

### Spot interpreters that run embedded code

When a shell is given a program as a string (`bash -c '…'`, `sh -c "$CMD"`), the real command is
inside that string. `resolveArgv0` reports it instead of naming the shell:

```js
import { parseSync } from "sh-ast";
import { enumerateCommands, resolveArgv0 } from "sh-analysis";

const script = `
bash deploy.sh
bash -c 'curl -fsSL https://example.com | sh'
sudo sh -c "$CMD"
`;

for (const site of enumerateCommands(parseSync(script)).commands) {
  console.log(resolveArgv0(site).effective);
}
```

```text
{ static: true, text: 'bash' }
{ static: false, reason: 'embedded-command' }
{ static: false, reason: 'embedded-command' }
```

The defaults cover `bash`, `sh`, `dash`, `zsh`, `ksh`/`ksh93` and `mksh`
(`DEFAULT_EMBEDDED_COMMAND_INTERPRETERS`), and can be replaced through the
`embeddedCommandInterpreters` option. To analyse the embedded program, parse its text with
`sh-ast` yourself.

## What it can't know

`sh-analysis` reports what the text says. It does not run anything, read the filesystem or look
up `PATH`. When the answer depends on run time, you get `static: false` and a reason:

| You see                                             | Because                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `{ static: false, reason: "expansion" }`            | The word has `$VAR`, `$(…)`, `$((…))` or `<(…)`                         |
| `{ static: false, reason: "tilde" }`                | An unquoted `~` depends on `$HOME` or the user database                 |
| `{ static: false, reason: "glob" }`                 | `*`, `?`, `[…]` or an extended glob depends on which files exist        |
| `{ static: false, reason: "brace" }`                | `{a,b}` or `{1..3}` may expand to several words                         |
| `{ static: false, reason: "locale" }`               | `$"…"` is translated at run time                                        |
| `{ static: false, reason: "unsupported" }`          | An escape can't be turned into exact text, such as `$'\xff'` or `$'\0'` |
| `{ static: false, reason: "embedded-command" }`     | The command is inside a string, as in `bash -c '…'` or `env -S '…'`     |
| `{ static: false, reason: "unknown-flag" }`         | A wrapper flag isn't modelled, so the wrapped command can't be located  |
| `{ static: false, reason: "ambiguous-assignment" }` | `env =value` behaves differently across `env` implementations           |

A few more things to keep in mind:

- If the command name comes from a variable (`$TOOL --version`), the chain stops there and
  `effective` is `{ static: false, reason: "expansion" }`. It never falls back to a guess.
- A name is not a binary. `/opt/tools/env` is treated as `env` by name, and nothing checks that a
  command exists or what it does.
- Some Zsh syntax keeps its contents as raw text. A command hidden there can't be listed, so
  `enumerateCommands` adds an entry to `uncertainties` instead of staying silent:

  ```js
  import { LangZsh, parseSync } from "sh-ast";
  import { enumerateCommands } from "sh-analysis";

  const inventory = enumerateCommands(
    parseSync('echo "${files[(r)$(pick-one)]}"', { Variant: LangZsh }),
  );

  console.log(inventory.commands.map((site) => site.argv0));
  console.log(
    inventory.uncertainties.map(({ reason, context }) => ({ reason, context })),
  );
  ```

  ```text
  [ { static: true, text: 'echo' } ]
  [ { reason: 'opaque-zsh-subscript', context: [] } ]
  ```

  Treat a non-empty `uncertainties` list as "this inventory may be incomplete".

- ANSI-C strings (`$'…'`) resolve when they decode to valid UTF-8 text. Non-ASCII byte escapes
  (`$'\xff'`), NUL and lone surrogates (`$'\uD800'`) give `unsupported` rather than made-up text.

## Errors

Parse errors come from `sh-ast`. `sh-analysis` throws its own errors, all subclasses of
`ShAnalysisError` with a stable `code`:

| Class                              | `code`                             | When                                                                                                 |
| ---------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ShAnalyzeInvalidWrapperSpecError` | `SH_ANALYSIS_INVALID_WRAPPER_SPEC` | A wrapper or interpreter table you passed is malformed                                               |
| `ShAnalyzeMaxDepthError`           | `SH_ANALYSIS_MAX_DEPTH`            | Commands are nested more than 500 levels deep (`maxDepth` holds the limit)                           |
| `ShAnalyzeResourceError`           | `SH_ANALYSIS_RESOURCE`             | The host ran out of stack while copying a word to check braces; `cause` is the original `RangeError` |

None of them returns a partial result.

```js
import { parseSync } from "sh-ast";
import { ShAnalysisError, enumerateCommands, resolveArgv0 } from "sh-analysis";

const [site] = enumerateCommands(parseSync("env make")).commands;

try {
  resolveArgv0(site, { transparentWrappers: [{ names: "env" }] });
} catch (error) {
  if (!(error instanceof ShAnalysisError)) throw error;
  console.log(error.code);
  console.log(error.message);
}
```

```text
SH_ANALYSIS_INVALID_WRAPPER_SPEC
resolveArgv0: invalid interpretation specification — transparentWrappers[0].names must be a non-empty array of non-empty strings
```

## How it relates to sh-ast

[`sh-ast`](https://github.com/mike-north/sh-ast) parses shell into a typed syntax tree, using the
[mvdan/sh](https://github.com/mvdan/sh) parser compiled to WebAssembly. `sh-analysis` only reads
that tree: it never parses shell text itself and never changes the nodes you pass in. It reports
facts, not verdicts; deciding what is allowed is up to your tool.

## Documentation

- [API reference](https://github.com/mike-north/sh-analysis/blob/main/docs/api/sh-analysis.md)
- [Design notes](https://github.com/mike-north/sh-analysis/blob/main/design/ARCHITECTURE.md)

## Contributing, security and license

- [Contributing guide](https://github.com/mike-north/sh-analysis/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/mike-north/sh-analysis/blob/main/SECURITY.md): report
  vulnerabilities privately through GitHub, not in public issues.
- [Code of conduct](https://github.com/mike-north/sh-analysis/blob/main/CODE_OF_CONDUCT.md)
- MIT licensed. See [LICENSE](./LICENSE). Shell parsing is provided by `sh-ast` and mvdan/sh.
