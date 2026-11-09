/** Malformed wrapper assumptions fail at their configuration boundary before any command scanning. */
import { expect, it } from "vitest";
import { parseSync } from "sh-ast";
import {
  enumerateCommands,
  resolveArgv0,
  ShAnalysisError,
  ShAnalyzeInvalidWrapperSpecError,
} from "../../src/index.js";
import type {
  Argv0Resolution,
  CommandSite,
  WrapperSpec,
} from "../../src/index.js";

/** These single-command fixtures are parsed for observation only; no source is executed. */
function site(source = "other task"): CommandSite {
  const inventory = enumerateCommands(parseSync(source));
  if (inventory.commands.length !== 1 || !inventory.commands[0]) {
    throw new Error("expected one command site");
  }
  return inventory.commands[0];
}

/** JavaScript callers can bypass static types; the one cast intentionally exercises that raw boundary. */
function rawTable(table: unknown, source?: string): Argv0Resolution {
  return resolveArgv0(site(source), {
    transparentWrappers: table as readonly WrapperSpec[],
  });
}

/** Assert the owning typed error instead of accepting a native failure or successful classification. */
function expectConfigurationFailure(
  operation: () => unknown,
  context: RegExp,
): void {
  let failure: unknown;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ShAnalyzeInvalidWrapperSpecError);
  expect(failure).toBeInstanceOf(ShAnalysisError);
  expect(failure).not.toBeInstanceOf(TypeError);
  if (!(failure instanceof ShAnalyzeInvalidWrapperSpecError)) {
    throw new Error("missing analysis-owned configuration refusal");
  }
  expect(failure.code).toBe("SH_ANALYSIS_INVALID_WRAPPER_SPEC");
  expect(failure.message).toMatch(context);
}

it.each([null, undefined, 42, "model", false])(
  "rejects invalid wrapper entry %s through its own boundary error",
  (entry) => {
    expectConfigurationFailure(
      () => rawTable([entry]),
      /transparentWrappers\[0\]/,
    );
  },
);

it.each([null, 42, {}, "models", false, () => undefined])(
  "rejects non-array supplied wrapper table %s",
  (table) => {
    expectConfigurationFailure(() => rawTable(table), /transparentWrappers/);
  },
);

it("rejects a sparse table even when dynamic argv0 prevents all wrapper matching", () => {
  expectConfigurationFailure(
    () => rawTable(new Array<WrapperSpec>(1), "$command task"),
    /transparentWrappers\[0\]/,
  );
});

it("validates a missing table slot after a valid model before scanning its flags", () => {
  const table: WrapperSpec[] = [{ names: ["x"] }];
  table.length = 2;
  expectConfigurationFailure(
    () => rawTable(table, "x -unknown task"),
    /transparentWrappers\[1\]/,
  );
});

it.each([
  "noArgFlags",
  "argFlags",
  "unresolvableFlags",
  "stopsChainFlags",
] as const)(
  "rejects missing elements in %s, including holes after a valid string",
  (field) => {
    for (const values of [
      new Array<string>(1),
      Object.assign(new Array<string>(2), { 0: "-q" }),
    ]) {
      expectConfigurationFailure(
        () => rawTable([{ names: ["x"], [field]: values }]),
        new RegExp(`transparentWrappers\\[0\\].${field}`),
      );
    }
  },
);

it("omission and explicit undefined retain the documented default wrapper assumptions", () => {
  const invocation = site("env A=1 target");
  const expected = { static: true, text: "target" };
  expect(resolveArgv0(invocation).effective).toEqual(expected);
  expect(resolveArgv0(invocation, {}).effective).toEqual(expected);
  expect(rawTable(undefined, "env A=1 target").effective).toEqual(expected);
});

it("a valid empty table intentionally disables default wrapper following", () => {
  expect(rawTable([], "env A=1 target").effective).toEqual({
    static: true,
    text: "env",
  });
});

it("accepts complete empty flag arrays without inventing any flag grammar", () => {
  const model: WrapperSpec = {
    names: ["x"],
    noArgFlags: [],
    argFlags: [],
    unresolvableFlags: [],
    stopsChainFlags: [],
  };
  expect(rawTable([model], "x target").effective).toEqual({
    static: true,
    text: "target",
  });
});

it.each(["run", "alias"])(
  "retains valid flags, repeated model references and %s name matching",
  (name) => {
    const names = Object.freeze(["run", "alias"]);
    const noArgFlags = Object.freeze(["-q"]);
    const model: WrapperSpec = { names, noArgFlags, argFlags: ["-u"] };
    const table = Object.freeze([model, model]);
    const result = rawTable(table, `${name} -q -u user target`);
    expect(result.effective).toEqual({ static: true, text: "target" });
    expect(result.chainIndices).toEqual([0, 4]);
    expect(model.names).toBe(names);
    expect(model.noArgFlags).toBe(noArgFlags);
    expect(table[0]).toBe(table[1]);
  },
);
