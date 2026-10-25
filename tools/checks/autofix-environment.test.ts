import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const Steps = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
const Workflow = Schema.Struct({
  jobs: Schema.Record(Schema.String, Schema.Struct({ steps: Steps })),
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const stepsOf = (file: string, job: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
      parse(yield* fs.readFileString(path.resolve(import.meta.dirname, "../..", file))),
    );
    return workflow.jobs[job]?.steps ?? [];
  });

const withoutCondition = (steps: typeof Steps.Type) =>
  steps.map((step) => Object.fromEntries(Object.entries(step).filter(([key]) => key !== "if")));

it("prepares the same environment for Claude as the verify job has before it runs verify", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const verify = yield* stepsOf(".github/workflows/verify.yml", "verify");
      const autofix = yield* stepsOf(".github/workflows/autofix.yml", "autofix");
      const run = verify.findIndex((step) => step["run"] === "vp run --log grouped verify");
      const target = autofix.findIndex((step) => step["id"] === "target");
      const claude = autofix.findIndex((step) => step["id"] === "claude");
      expect(run).toBeGreaterThan(1);
      expect(target).toBeGreaterThan(-1);
      expect(claude).toBeGreaterThan(target);
      expect(withoutCondition(autofix.slice(target + 1, claude))).toEqual(verify.slice(1, run));
    }),
  ));
