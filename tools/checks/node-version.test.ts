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

const THIS_REPOSITORY = "${{ github.repository }}";

const workspacePath = (value: string) =>
  value
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");

const isInside = (file: string, directory: string) =>
  directory === "" || file === directory || file.startsWith(`${directory}/`);

const sparseKeepsNodeVersion = (options: Readonly<Record<string, unknown>>) => {
  const sparse = options["sparse-checkout"];
  if (sparse === undefined) return true;
  if (options["sparse-checkout-cone-mode"] !== false) return true;
  return String(sparse)
    .split("\n")
    .map((line) => workspacePath(line.trim()))
    .includes(NODE_VERSION_FILE);
};

const nodeVersionLocations = (steps: ReadonlyArray<typeof Step.Type>, setupIndex: number) =>
  steps
    .slice(0, setupIndex)
    .filter(({ uses }) => uses?.startsWith("actions/checkout@") === true)
    .reduce<ReadonlyArray<string>>((locations, { with: options = {} }) => {
      const directory = workspacePath(String(options["path"] ?? "."));
      const kept = locations.filter((location) => !isInside(location, directory));
      const repository = options["repository"];
      const thisRepository = repository === undefined || repository === THIS_REPOSITORY;
      return thisRepository && sparseKeepsNodeVersion(options)
        ? [...kept, workspacePath(`${directory}/${NODE_VERSION_FILE}`)]
        : kept;
    }, []);

const checksOutNodeVersion = (steps: ReadonlyArray<typeof Step.Type>, setupIndex: number) => {
  const file = steps[setupIndex]?.with?.["node-version-file"];
  return (
    typeof file === "string" &&
    nodeVersionLocations(steps, setupIndex).includes(workspacePath(file))
  );
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
        .filter(({ step }) => {
          const file = step.with?.["node-version-file"];
          return (
            typeof file !== "string" || workspacePath(file).split("/").at(-1) !== NODE_VERSION_FILE
          );
        })
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

const checkout = (options?: Record<string, unknown>) => ({
  uses: "actions/checkout@v7",
  ...(options === undefined ? {} : { with: options }),
});
const setupVp = (file = NODE_VERSION_FILE) => ({
  uses: "voidzero-dev/setup-vp@v1",
  with: { "node-version-file": file },
});

it.each([
  { found: true, name: "a plain checkout", steps: [checkout(), setupVp()] },
  { found: false, name: "no checkout", steps: [setupVp()] },
  {
    found: false,
    name: "a sparse-checkout without .node-version",
    steps: [
      checkout({ "sparse-checkout": "package.json", "sparse-checkout-cone-mode": false }),
      setupVp(),
    ],
  },
  {
    found: true,
    name: "a sparse-checkout that lists .node-version",
    steps: [
      checkout({
        "sparse-checkout": "package.json\n.node-version",
        "sparse-checkout-cone-mode": false,
      }),
      setupVp(),
    ],
  },
  {
    found: true,
    name: "a cone-mode sparse-checkout, which keeps root files",
    steps: [checkout({ "sparse-checkout": "apps" }), setupVp()],
  },
  { found: false, name: "a checkout into a path", steps: [checkout({ path: "sub" }), setupVp()] },
  {
    found: true,
    name: "a checkout into a path read from that path",
    steps: [checkout({ path: "sub" }), setupVp("sub/.node-version")],
  },
  {
    found: false,
    name: "a checkout of another repository",
    steps: [checkout({ repository: "someone/else" }), setupVp()],
  },
  {
    found: true,
    name: "this repository checked out by name",
    steps: [checkout({ repository: THIS_REPOSITORY }), setupVp()],
  },
  {
    found: true,
    name: "another repository checked out beside this one",
    steps: [checkout(), checkout({ path: "other", repository: "someone/else" }), setupVp()],
  },
  {
    found: false,
    name: "another repository checked out over this one",
    steps: [checkout(), checkout({ repository: "someone/else" }), setupVp()],
  },
])("finds .node-version where setup-vp reads it after $name", ({ steps, found }) => {
  expect(checksOutNodeVersion(steps, steps.length - 1)).toBe(found);
});
