import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const ALLOWED_JOBS: ReadonlySet<string> = new Set(["commits", "ci-telemetry"]);

const Trigger = Schema.NullOr(
  Schema.Struct({
    types: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  }),
);

const Events = Schema.Union([
  Schema.String,
  Schema.Array(Schema.String),
  Schema.Struct({ pull_request: Schema.optional(Trigger) }),
]);

const Workflow = Schema.Struct({
  jobs: Schema.Record(Schema.String, Schema.Unknown),
  on: Events,
});

const pullRequestTypes = (on: typeof Events.Type): ReadonlyArray<string> => {
  if (typeof on === "string" || Array.isArray(on)) return [];
  const types = "pull_request" in on ? on.pull_request?.types : undefined;
  return types === undefined ? [] : typeof types === "string" ? [types] : types;
};

const problemsOf = (file: string, workflow: typeof Workflow.Type): ReadonlyArray<string> =>
  pullRequestTypes(workflow.on).includes("edited")
    ? Object.keys(workflow.jobs)
        .filter((name) => !ALLOWED_JOBS.has(name))
        .map((name) => `${file}: ${name} runs again whenever a pull request is edited`)
    : [];

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
  return { files, problems: problems.flat() };
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

it("runs only the commits job when a pull request is edited", () =>
  runtime.runPromise(checkWorkflows));
