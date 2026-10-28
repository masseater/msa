import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, ManagedRuntime, Path, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";

const NODE_VERSION_FILE = ".node-version";

const Step = Schema.Struct({
  uses: Schema.optional(Schema.String),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const Workflow = Schema.Struct({
  jobs: Schema.Record(Schema.String, Schema.Struct({ steps: Schema.optional(Schema.Array(Step)) })),
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const root = `${import.meta.dirname}/../..`;

it("runs the tests on the Node.js that .node-version pins", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const pinned = (yield* fs.readFileString(`${root}/${NODE_VERSION_FILE}`)).trim();
      expect(process.versions.node, `install Node.js ${pinned} from ${NODE_VERSION_FILE}`).toBe(
        pinned,
      );
    }),
  ));

const isSetupVp = ({ uses }: typeof Step.Type) =>
  uses?.startsWith("voidzero-dev/setup-vp@") === true;

const checksOutNodeVersion = (steps: ReadonlyArray<typeof Step.Type>, setupIndex: number) => {
  const checkout = steps
    .slice(0, setupIndex)
    .findLast(({ uses }) => uses?.startsWith("actions/checkout@") === true);
  if (checkout === undefined) return false;
  const sparse = checkout.with?.["sparse-checkout"];
  if (sparse === undefined) return true;
  return String(sparse)
    .split("\n")
    .map((line) => line.trim())
    .includes(NODE_VERSION_FILE);
};

const setupVpJobs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(root, ".github/workflows");
  const files = (yield* fs.readDirectory(directory)).filter((name) => /\.ya?ml$/u.test(name));
  const jobs = yield* Effect.forEach(files, (name) =>
    Effect.gen(function* () {
      const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
        parse(yield* fs.readFileString(path.join(directory, name))),
      );
      return Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
        steps.flatMap((step, index) =>
          isSetupVp(step) ? [{ index, label: `${name}: ${job}`, step, steps }] : [],
        ),
      );
    }),
  );
  return jobs.flat();
});

it("installs the pinned Node.js in every workflow that sets up vp", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const unpinned = (yield* setupVpJobs)
        .filter(({ step }) => step.with?.["node-version-file"] !== NODE_VERSION_FILE)
        .map(({ label }) => label);
      expect(unpinned).toEqual([]);
    }),
  ));

it("checks out .node-version before every setup-vp step that reads it", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const missing = (yield* setupVpJobs)
        .filter(({ steps, index }) => !checksOutNodeVersion(steps, index))
        .map(({ label }) => label);
      expect(missing).toEqual([]);
    }),
  ));
