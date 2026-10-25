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

it("installs the pinned Node.js in every workflow that sets up vp", () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(root, ".github/workflows");
      const files = (yield* fs.readDirectory(directory)).filter((name) => /\.ya?ml$/u.test(name));
      const unpinned = yield* Effect.forEach(files, (name) =>
        Effect.gen(function* () {
          const workflow = yield* Schema.decodeUnknownEffect(Workflow)(
            parse(yield* fs.readFileString(path.join(directory, name))),
          );
          return Object.entries(workflow.jobs).flatMap(([job, { steps }]) =>
            (steps ?? [])
              .filter(({ uses }) => uses?.startsWith("voidzero-dev/setup-vp@") === true)
              .filter((step) => step.with?.["node-version-file"] !== NODE_VERSION_FILE)
              .map(() => `${name}: ${job}`),
          );
        }),
      );
      expect(unpinned.flat()).toEqual([]);
    }),
  ));
