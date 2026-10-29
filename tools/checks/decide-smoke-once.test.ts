import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const DECIDE_SMOKE = "smoke-binary-decide";
const BUILD_BINARIES = "build-binaries";
const LOCAL_LLM_TESTS_ENV = "MSA_LOCAL_LLM_TESTS";

const Env = Schema.Record(Schema.String, Schema.Unknown);

const Step = Schema.Struct({ env: Schema.optional(Env), run: Schema.optional(Schema.String) });

const Job = Schema.Struct({
  env: Schema.optional(Env),
  steps: Schema.optional(Schema.Array(Step)),
});

const Workflow = Schema.Struct({
  env: Schema.optional(Env),
  jobs: Schema.Record(Schema.String, Job),
});

const localLlmTestsOn = (...envs: ReadonlyArray<typeof Env.Type | undefined>) =>
  envs.some((env) => String(env?.[LOCAL_LLM_TESTS_ENV]) === "1");

const decideRunsOf = (workflow: typeof Workflow.Type, job: typeof Job.Type) =>
  (job.steps ?? []).flatMap((step) => {
    const run = step.run ?? "";
    const explicit = run.includes(DECIDE_SMOKE) ? [`runs ${DECIDE_SMOKE}`] : [];
    const inBuild =
      run.includes(BUILD_BINARIES) && localLlmTestsOn(workflow.env, job.env, step.env)
        ? [`runs ${BUILD_BINARIES} with ${LOCAL_LLM_TESTS_ENV}=1`]
        : [];
    return explicit.concat(inBuild);
  });

const problemsOf = (file: string, workflow: typeof Workflow.Type): ReadonlyArray<string> =>
  Object.entries(workflow.jobs).flatMap(([name, job]) => {
    const binaryJob = (job.steps ?? []).some(
      (step) => step.run?.includes(BUILD_BINARIES) || step.run?.includes(DECIDE_SMOKE),
    );
    const runs = decideRunsOf(workflow, job);
    return !binaryJob || runs.length === 1
      ? []
      : [`${file}: ${name} runs the decide smoke ${runs.length} times (${runs.join("; ")})`];
  });

const collectProblems = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.resolve(import.meta.dirname, "../../.github/workflows");
  const files = (yield* fs.readDirectory(directory)).filter((name) => /\.ya?ml$/u.test(name));
  const problems = yield* Effect.forEach(files, (name) =>
    Effect.gen(function* () {
      const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
        parse(yield* fs.readFileString(path.join(directory, name))),
      );
      return problemsOf(name, workflow);
    }),
  );
  return problems.flat();
});

const runtime = ManagedRuntime.make(NodeServices.layer);

it(`runs the decide smoke exactly once in every workflow job that builds or smoke-tests binaries`, () =>
  runtime.runPromise(
    collectProblems.pipe(Effect.tap((problems) => Effect.sync(() => expect(problems).toEqual([])))),
  ));
