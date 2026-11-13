/**
 * Flat command chains and flat arithmetic or test expressions of any length are analysed without
 * exhausting the native stack. One case parses real 10,000-link source; the remaining constructed
 * trees cover other syntax shapes and records that cannot be written as valid source. Each is
 * enumerated in a fresh process.
 *
 * Expected outcomes follow from the shell meaning of the source: a command substitution
 * inside an arithmetic expansion, subscript, slice or test runs, wherever it sits in the chain.
 *
 * @see https://www.gnu.org/software/bash/manual/bash.html#Shell-Arithmetic
 * @see https://www.gnu.org/software/bash/manual/bash.html#Conditional-Constructs
 * @see https://www.gnu.org/software/bash/manual/bash.html#Shell-Parameter-Expansion
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { object } from "./support.ts";

const environment = { ...process.env };
delete environment.NODE_OPTIONS;
const run = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    fileURLToPath(new URL("./fixtures/long-chains-child.ts", import.meta.url)),
  ],
  { env: environment, encoding: "utf8", timeout: 120000 },
);
const outcomes = run.status === 0 ? object(JSON.parse(run.stdout)) : {};

/** The two hidden commands bracket the chain; `echo` itself is a site only when the chain is an argument. */
const HIDDEN = [
  { argv0: "first", context: ["cmdSubst"] },
  { argv0: "last", context: ["cmdSubst"] },
];

void test("the long-chain driver completes in a fresh process", () => {
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});

void test("hidden commands at both ends of a 10,000-term arithmetic expansion are found", () => {
  assert.deepEqual(
    object(outcomes["arithmetic expansion spine"]).sites,
    HIDDEN,
  );
});

void test("a command whose argument holds a 10,000-term arithmetic expansion is enumerated", () => {
  assert.deepEqual(
    object(outcomes["arithmetic expansion spine in a command argument"]).sites,
    [{ argv0: "echo", context: [] }, ...HIDDEN],
  );
});

void test("a parsed 10,000-link arithmetic argument is enumerated", () => {
  assert.deepEqual(
    object(outcomes["parsed arithmetic expansion in a command argument"]).sites,
    [{ argv0: "echo", context: [] }, ...HIDDEN],
  );
});

for (const name of [
  "arithmetic command spine",
  "let expression spine",
  "array subscript spine",
  "test expression || spine",
]) {
  void test(`hidden commands at both ends of a 10,000-link ${name} are found`, () => {
    assert.deepEqual(object(outcomes[name]).sites, HIDDEN);
  });
}

void test("hidden commands at both ends of a 10,000-term slice offset are found", () => {
  assert.deepEqual(
    object(outcomes["parameter slice offset spine"]).sites,
    HIDDEN,
  );
});

void test("an opaque Zsh subscript at the end of a 10,000-term spine is still reported", () => {
  const outcome = object(
    outcomes["opaque zsh subscript at the end of a spine"],
  );
  assert.deepEqual(outcome.uncertainties, [
    { reason: "opaque-zsh-subscript", context: [], isLeaf: true },
  ]);
});

void test("10,000-link && and pipeline chains report every operand", () => {
  for (const name of ["&& chain", "pipeline chain"]) {
    const sites = object(outcomes[name]).sites;
    assert.ok(Array.isArray(sites));
    assert.equal(sites.length, 10_001, name);
  }
});

void test("an elif chain with empty clauses reports only the commands outside it, however long", () => {
  // if a; then :; elif ...: only the first condition holds a statement.
  assert.deepEqual(object(outcomes["elif chain without statements"]).sites, [
    { argv0: "a", context: ["if:cond"] },
  ]);
});

void test("a 10,000-clause elif chain with statements is refused by the nesting limit, not the stack", () => {
  assert.deepEqual(object(outcomes["elif chain with statements"]).failure, {
    name: "ShAnalyzeMaxDepthError",
    code: "SH_ANALYSIS_MAX_DEPTH",
    isRangeError: false,
  });
});
