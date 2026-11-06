/** Validate external CLI and workflow data before tests use it as evidence. */
import assert from "node:assert/strict";
import { parse } from "yaml";

/** Workflow steps expose only the fields asserted by release-boundary tests. */
interface IWorkflowStep {
  readonly uses: unknown;
  readonly if: unknown;
  readonly run: string | undefined;
  readonly with: Record<string, unknown>;
  readonly "continue-on-error": unknown;
}

/** Preserve arbitrary job metadata while validating its executable step sequence. */
interface IWorkflowJob extends Record<string, unknown> {
  readonly steps: readonly IWorkflowStep[];
}

/** Release tests inspect event, permission, and job boundaries independently of GitHub execution. */
interface IWorkflow {
  readonly on: Record<string, unknown>;
  readonly permissions: unknown;
  readonly jobs: Record<string, IWorkflowJob>;
}

/** Retain unknown array elements until callers validate their individual contracts. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** JSON and YAML objects must be validated rather than trusted through a type assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Fail malformed evidence at its boundary instead of interpreting absent fields as success. */
export function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

/** CLI result arrays contain validated objects; individual policy fields remain unknown. */
export function objects(value: unknown): readonly Record<string, unknown>[] {
  assert.ok(isUnknownArray(value));
  return value.map(object);
}

/** Build a checked view of a workflow without assuming YAML's return type is trustworthy. */
export function workflow(source: string): IWorkflow {
  const parsed = object(parse(source));
  const jobs: Record<string, IWorkflowJob> = {};
  for (const [name, value] of Object.entries(object(parsed.jobs))) {
    const job = object(value);
    const steps = objects(job.steps).map((step): IWorkflowStep => {
      assert.ok(step.run === undefined || typeof step.run === "string");
      return {
        uses: step.uses,
        if: step.if,
        run: step.run,
        with: step.with === undefined ? {} : object(step.with),
        "continue-on-error": step["continue-on-error"],
      };
    });
    jobs[name] = { ...job, steps };
  }
  return { on: object(parsed.on), permissions: parsed.permissions, jobs };
}
