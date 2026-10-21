import { NodeServices } from "@effect/platform-node";
import { Data, Effect, FileSystem, ManagedRuntime, Path } from "effect";
import { build } from "esbuild";
import type { BuildOptions, Metafile, Plugin } from "esbuild";
import { expect, it } from "vite-plus/test";

import esbuildFilter from "../../scripts/esbuild-filter.ts";

const { EsbuildFilter } = esbuildFilter;

const DURABLE_REQUIRED_INPUTS = [
  "libs/durable/src/index.ts",
  "libs/durable/src/env/index.ts",
  "libs/durable/src/storage/jsonl/index.ts",
  "libs/durable/src/storage/jsonl/storage.ts",
  "libs/durable/src/storage/memory.ts",
  "libs/durable/src/storage/sqlite/index.ts",
  "libs/durable/src/storage/sqlite/storage.ts",
];

const DURABLE_NODE_INPUTS = [
  "libs/durable/src/env/node.ts",
  "libs/durable/src/storage/jsonl/node.ts",
  "libs/durable/src/storage/sqlite/node.ts",
];

const AGENT_FORBIDDEN_INPUTS = [
  "libs/ai/src/compat.ts",
  "libs/ai/src/models.generated.ts",
  "libs/ai/src/providers/all.ts",
];

const AI_SDK_PACKAGES = ["@anthropic-ai/sdk", "@google/genai", "openai"];

class BundleError extends Data.TaggedError("BundleError")<{ readonly message: string }> {}

type Inputs = Metafile["inputs"];

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const findInput = (inputs: Inputs, suffix: string): string | undefined =>
  Object.keys(inputs).find((input) => {
    const normalized = normalizePath(input);
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  });

const includesNodePackage = (inputs: Inputs, packageName: string): boolean =>
  Object.keys(inputs).some((input) =>
    normalizePath(input).includes(`node_modules/${packageName}/`),
  );

const missingInput = (inputs: Inputs, required: ReadonlyArray<string>): string | undefined =>
  required.find((input) => findInput(inputs, input) === undefined);

const includedInput = (inputs: Inputs, forbidden: ReadonlyArray<string>): string | undefined =>
  forbidden.map((input) => findInput(inputs, input)).find((found) => found !== undefined);

const describeFound = (found: ReadonlyArray<string>): string =>
  found.length > 0 ? found.join(", ") : "none";

const catalogDataPlugin = (
  path: Path.Path,
  dataDir: string,
  existing: ReadonlySet<string>,
): Plugin => ({
  name: "generated-model-catalog",
  setup(esbuild) {
    esbuild.onResolve({ filter: new EsbuildFilter(/^\.\/data\/[^/]+\.json$/u) }, (args) => {
      const resolved = path.resolve(path.dirname(args.importer), args.path);
      if (path.dirname(resolved) !== dataDir || existing.has(resolved)) return undefined;
      return { namespace: "empty-generated-model-catalog", path: resolved };
    });
    esbuild.onLoad(
      { filter: new EsbuildFilter(/.*/u), namespace: "empty-generated-model-catalog" },
      () => ({ contents: "{}", loader: "json" }),
    );
  },
});

const runBuild = (options: BuildOptions) =>
  Effect.tryPromise({
    catch: (cause) => new BundleError({ message: `esbuild build failed: ${String(cause)}` }),
    try: () =>
      build({
        ...options,
        bundle: true,
        format: "esm",
        logLevel: "silent",
        platform: "browser",
        write: false,
      }),
  });

const metafileOf = (options: BuildOptions) =>
  runBuild({ ...options, metafile: true }).pipe(
    Effect.flatMap((result) =>
      result.metafile === undefined
        ? Effect.fail(new BundleError({ message: "esbuild did not return a metafile" }))
        : Effect.succeed(result.metafile),
    ),
  );

const durableProblems = (inputs: Inputs): ReadonlyArray<string> => {
  const missing = missingInput(inputs, DURABLE_REQUIRED_INPUTS);
  const nodeAdapter = includedInput(inputs, DURABLE_NODE_INPUTS);
  return [
    ...(missing === undefined ? [] : [`Durable browser bundle does not include ${missing}`]),
    ...(nodeAdapter === undefined
      ? []
      : [`Durable browser bundle unexpectedly includes ${nodeAdapter}`]),
  ];
};

const agentSdkProblems = (inputs: Inputs): ReadonlyArray<string> => {
  const found = AI_SDK_PACKAGES.filter((name) => includesNodePackage(inputs, name));
  return found.length === 1 && found[0] === "@anthropic-ai/sdk"
    ? []
    : [
        `Agent selective-provider bundle SDKs: expected only @anthropic-ai/sdk, found ${describeFound(found)}`,
      ];
};

const agentInputProblems = (inputs: Inputs): ReadonlyArray<string> => {
  const forbidden = includedInput(inputs, AGENT_FORBIDDEN_INPUTS);
  return [
    ...(forbidden === undefined
      ? []
      : [`Agent selective-provider bundle unexpectedly includes ${forbidden}`]),
    ...agentSdkProblems(inputs),
  ];
};

const agentCatalogProblems = (metafile: Metafile): ReadonlyArray<string> => {
  const contributing = new Set(
    Object.values(metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs)
        .filter(([, contribution]) => contribution.bytesInOutput > 0)
        .map(([input]) => input),
    ),
  );
  const catalogs = [...contributing].filter((input) =>
    normalizePath(input).includes("libs/ai/src/providers/data/"),
  );
  const [onlyCatalog] = catalogs;
  return catalogs.length === 1 &&
    onlyCatalog !== undefined &&
    normalizePath(onlyCatalog).endsWith("/anthropic-api.json")
    ? []
    : [
        `Agent selective-provider bundle catalogs: expected only anthropic-api.json, found ${describeFound(catalogs)}`,
      ];
};

const collectProblems = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../..");
  const dataDir = path.join(root, "libs/ai/src/providers/data");
  const existing = new Set(
    (yield* fs.readDirectory(dataDir).pipe(Effect.orElseSucceed(() => [] as Array<string>))).map(
      (name) => path.join(dataDir, name),
    ),
  );
  const plugin = catalogDataPlugin(path, dataDir, existing);
  const entry = (name: string) => path.join(root, "tools/checks/entries", name);

  yield* runBuild({ entryPoints: [entry("browser-smoke-entry.ts")], plugins: [plugin] });
  const durable = yield* metafileOf({ entryPoints: [entry("durable-browser-smoke-entry.ts")] });
  const agent = yield* metafileOf({
    entryPoints: [entry("agent-treeshake-smoke-entry.ts")],
    plugins: [plugin],
  });
  return [
    ...durableProblems(durable.inputs),
    ...agentInputProblems(agent.inputs),
    ...agentCatalogProblems(agent),
  ];
});

const runtime = ManagedRuntime.make(NodeServices.layer);

const checkBundles = collectProblems.pipe(
  Effect.tap((problems) => Effect.sync(() => expect(problems).toEqual([]))),
);

it("keeps the browser bundles browser-safe and tree-shaken", () =>
  runtime.runPromise(checkBundles));
