/** A fresh normal-stack process requires a known typed deep-input refusal, without assuming which host boundary refuses first. */
import assert from "node:assert/strict";
import {
  parseSync,
  printSync,
  splitBraces,
  ShInternalError,
  ShAstError,
} from "sh-ast";
import * as analysis from "sh-analysis";
import type { Word } from "sh-ast";

/** Parser-produced templates retain every field; only the nested expansion Word is replaced. */
function argument(source: string): Word {
  const command = parseSync(`echo ${source}`).Stmts?.[0]?.Cmd;
  assert.ok(command?.Type === "CallExpr");
  assert.ok(command.Args?.[1]);
  return command.Args[1];
}

/** Snapshot all own keys, scalar values and references without recursively walking the deep graph. */
function remember(root: unknown): () => number {
  const entries: {
    value: object;
    keys: (string | symbol)[];
    values: unknown[];
  }[] = [];
  const seen = new Set<object>();
  const work: unknown[] = [root];
  while (work.length > 0) {
    const value = work.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const keys = Reflect.ownKeys(value);
    const values: unknown[] = keys.map((key): unknown =>
      Reflect.get(value, key),
    );
    entries.push({ value, keys, values });
    for (const child of values) work.push(child);
  }
  return () => {
    for (const entry of entries) {
      assert.deepEqual(Reflect.ownKeys(entry.value), entry.keys);
      for (let index = 0; index < entry.keys.length; index++) {
        assert.equal(
          Reflect.get(entry.value, entry.keys[index]),
          entry.values[index],
        );
      }
    }
    return entries.length;
  };
}

/** Accept only the observed copy refusal or the binding's exact input-preflight refusal. */
function refusalStage(failure: unknown): "analysis-copy" | "binding-input" {
  assert.ok(
    failure,
    "Deep input must refuse rather than return a successful observation",
  );
  if (failure instanceof analysis.ShAnalyzeResourceError) {
    assert.ok(failure instanceof analysis.ShAnalysisError);
    assert.ok(!(failure instanceof ShAstError));
    assert.ok(!(failure instanceof analysis.ShAnalyzeMaxDepthError));
    assert.equal(failure.code, "SH_ANALYSIS_RESOURCE");
    assert.equal(failure.operation, "brace-observation-copy");
    assert.ok(failure.cause instanceof RangeError);
    assert.equal(failure.cause.message, "Maximum call stack size exceeded");
    return "analysis-copy";
  }
  assert.ok(
    failure instanceof ShInternalError,
    "Unexpected deep-input failure category",
  );
  assert.ok(!(failure instanceof analysis.ShAnalysisError));
  assert.equal(failure.code, "SH_AST_INTERNAL");
  assert.equal(
    failure.message,
    "SplitBraces input record depth 257 exceeds the bridge transport limit 256",
  );
  return "binding-input";
}

const parameter = argument("${x:-x}").Parts?.[0];
assert.ok(parameter?.Type === "ParamExp");
assert.ok(parameter.Exp);
let nested = argument("x");
for (let index = 0; index < 2000; index++) {
  nested = {
    Type: "Word",
    Parts: [{ ...parameter, Exp: { ...parameter.Exp, Word: nested } }],
  };
}
const word: Word = {
  Type: "Word",
  Parts: [...(argument("{a,b}").Parts ?? []), ...(nested.Parts ?? [])],
};
const unchanged = remember(word);
assert.throws(
  () => splitBraces(word),
  (error) => refusalStage(error) === "binding-input",
);
unchanged();
const attempts = [];
for (let iteration = 0; iteration < 3; iteration++) {
  let failure;
  try {
    analysis.resolveWord(word);
  } catch (error) {
    failure = error;
  }
  // Host clone capacity varies. A completed copy must reach the same typed
  // binding input refusal; a copy stack refusal must retain its own category.
  const stage = refusalStage(failure);
  assert.ok(
    failure instanceof analysis.ShAnalyzeResourceError ||
      failure instanceof ShInternalError,
  );
  const recordsUnchanged = unchanged();
  const ordinary = parseSync('env A=1 printf "ok"');
  assert.equal(printSync(ordinary), 'env A=1 printf "ok"\n');
  assert.deepEqual(analysis.resolveWord(argument("plain")), {
    static: true,
    text: "plain",
  });
  assert.deepEqual(analysis.resolveWord(argument("{a,b}")), {
    static: false,
    reason: "brace",
  });
  const inventory = analysis.enumerateCommands(ordinary);
  assert.equal(inventory.commands.length, 1);
  assert.deepEqual(inventory.uncertainties, []);
  assert.deepEqual(analysis.resolveArgv0(inventory.commands[0]).effective, {
    static: true,
    text: "printf",
  });
  attempts.push({
    iteration,
    stage,
    name: failure.name,
    message: failure.message,
    code: failure.code,
    operation:
      failure instanceof analysis.ShAnalyzeResourceError
        ? failure.operation
        : undefined,
    cause: failure.cause instanceof Error ? failure.cause.name : undefined,
    causeMessage:
      failure.cause instanceof Error ? failure.cause.message : undefined,
    recordsUnchanged,
    reused: true,
  });
}
console.log(JSON.stringify({ node: process.version, attempts }));
