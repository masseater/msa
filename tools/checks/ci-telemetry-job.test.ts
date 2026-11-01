import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const JOB = "ci-telemetry";
const SCRIPT = ".github/scripts/ci-telemetry.sh";
const SCRIPT_SHA256 = "790af7860c8ed9be31ab2bdda9b12e052d7a97659e1c948ee666f2ff0a2c6264";

const Step = Schema.Struct({ run: Schema.optional(Schema.String) });

const Job = Schema.Struct({
  if: Schema.optional(Schema.Unknown),
  needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  steps: Schema.optional(Schema.Array(Step)),
});

const Workflow = Schema.Struct({ jobs: Schema.Record(Schema.String, Job) });

const asList = (needs: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  needs === undefined ? [] : typeof needs === "string" ? [needs] : needs;

const problemsOf = (file: string, workflow: typeof Workflow.Type): ReadonlyArray<string> => {
  const names = Object.keys(workflow.jobs);
  const telemetry = workflow.jobs[JOB];
  if (telemetry === undefined) {
    return [`${file}: no ${JOB} job`];
  }
  const others = names.filter((name) => name !== JOB);
  const needs = asList(telemetry.needs);
  return [
    ...(names.at(-1) === JOB ? [] : [`${file}: ${JOB} is not the last job`]),
    ...(telemetry.if === "always()" ? [] : [`${file}: ${JOB} does not run with if: always()`]),
    ...others
      .filter((name) => !needs.includes(name))
      .map((name) => `${file}: ${JOB} does not need ${name}`),
    ...((telemetry.steps ?? []).some((step) => step.run === SCRIPT)
      ? []
      : [`${file}: ${JOB} does not run ${SCRIPT}`]),
  ];
};

const collectProblems = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const directory = path.join(root, ".github/workflows");
  const files = (yield* fs.readDirectory(directory)).filter((name) => /\.ya?ml$/u.test(name));
  const problems = yield* Effect.forEach(files, (name) =>
    Effect.gen(function* () {
      const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
        parse(yield* fs.readFileString(path.join(directory, name))),
      );
      return problemsOf(name, workflow);
    }),
  );
  const script = yield* fs.readFile(path.join(root, SCRIPT));
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new Uint8Array(script)),
  );
  const scriptProblems =
    Buffer.from(digest).toString("hex") === SCRIPT_SHA256
      ? []
      : [`${SCRIPT}: content differs from the template (sha256 ${SCRIPT_SHA256})`];
  return { files, problems: [...problems.flat(), ...scriptProblems] };
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const checkWorkflows = collectProblems.pipe(
  Effect.tap(({ files, problems }) =>
    Effect.sync(() => {
      expect(files).not.toEqual([]);
      expect(problems).toEqual([]);
    }),
  ),
);

it(`ends every workflow with a ${JOB} job that needs every other job and runs the template ${SCRIPT}`, () =>
  runtime.runPromise(checkWorkflows));
