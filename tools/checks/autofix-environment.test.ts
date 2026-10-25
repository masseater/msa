import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const Steps = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
const Job = Schema.Struct({
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  steps: Steps,
});
const Workflow = Schema.Struct({ jobs: Schema.Record(Schema.String, Job) });

const runtime = ManagedRuntime.make(NodeServices.layer);

const workflowOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* Schema.decodeUnknownEffect(Workflow)(
      parse(yield* fs.readFileString(path.resolve(import.meta.dirname, "../..", file))),
    );
  });

const stepsOf = (file: string, job: string) =>
  workflowOf(file).pipe(Effect.map((workflow) => workflow.jobs[job]?.steps ?? []));

const runsClaude = (step: (typeof Steps.Type)[number]) =>
  String(step["uses"] ?? "").startsWith("anthropics/claude-code-action@");

const pushes = (step: (typeof Steps.Type)[number]) =>
  String(step["run"] ?? "").includes("git push");

const checksOutWithDeployKey = (step: (typeof Steps.Type)[number]) => {
  const options = step["with"];
  return (
    String(step["uses"] ?? "").startsWith("actions/checkout@") &&
    typeof options === "object" &&
    options !== null &&
    "ssh-key" in options
  );
};

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

it("pushes the fix with the deploy key from a job that does not run Claude", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const { jobs } = yield* workflowOf(".github/workflows/autofix.yml");
      const claude = Object.values(jobs).filter((job) => job.steps.some(runsClaude));
      const pushing = Object.values(jobs).filter((job) => job.steps.some(pushes));
      expect(claude).toHaveLength(1);
      expect(claude[0]?.permissions?.["contents"]).toBe("read");
      expect(pushing).toHaveLength(1);
      expect(pushing[0]?.steps.some(runsClaude)).toBe(false);
      expect(pushing[0]?.steps.some(checksOutWithDeployKey)).toBe(true);
    }),
  ));
