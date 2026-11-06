/** A complete public-typechecked graph isolates host copying from parser nesting policy. */
import { parseSync } from "sh-ast";
import type { Word } from "sh-ast";

/** Select a complete Word so all retained syntax fields originate in the public parser. */
function argument(source: string): Word {
  const command = parseSync(`echo ${source}`).Stmts?.[0]?.Cmd;
  if (command?.Type !== "CallExpr" || !command.Args?.[1]) {
    throw new Error("missing fixture word");
  }
  return command.Args[1];
}

/** Build legal records iteratively; the leading brace candidate requires an observation copy. */
export function deepCopyWord(depth = 2000): Word {
  const parameter = argument("${x:-x}").Parts?.[0];
  if (parameter?.Type !== "ParamExp" || !parameter.Exp) {
    throw new Error("missing parameter-expansion template");
  }
  const expansion = parameter.Exp;
  let nested: Word = argument("x");
  for (let index = 0; index < depth; index++) {
    nested = {
      Type: "Word",
      Parts: [{ ...parameter, Exp: { ...expansion, Word: nested } }],
    };
  }
  return {
    Type: "Word",
    Parts: [...(argument("{a,b}").Parts ?? []), ...(nested.Parts ?? [])],
  };
}
