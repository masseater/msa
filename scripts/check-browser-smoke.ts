import { tmpdir } from "node:os";

import { Console, Data, Effect } from "effect";
import { build } from "esbuild";
import type { BuildOptions, Metafile, Plugin } from "esbuild";

import { Host, runScript } from "./host.ts";
import type { HostShape } from "./host.ts";

class SmokeCheckError extends Data.TaggedError("SmokeCheckError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

const toGoRegExp = (pattern: RegExp): RegExp =>
  new RegExp(pattern.source, pattern.flags.replace("u", ""));

const generatedCatalogDataPlugin = (host: HostShape, generatedCatalogDataDir: string): Plugin => ({
  name: "generated-model-catalog",
  setup(esbuild) {
    esbuild.onResolve({ filter: toGoRegExp(/^\.\/data\/[^/]+\.json$/u) }, (args) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const path = host.resolve(host.dirname(args.importer), args.path);
          if (host.dirname(path) !== generatedCatalogDataDir || (yield* host.exists(path))) {
            return undefined;
          }
          return { path, namespace: "empty-generated-model-catalog" };
        }),
      ),
    );
    esbuild.onLoad(
      { filter: toGoRegExp(/.*/u), namespace: "empty-generated-model-catalog" },
      () => ({
        contents: "{}",
        loader: "json",
      }),
    );
  },
});

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const findInput = (inputs: Metafile["inputs"], suffix: string): string | undefined =>
  Object.keys(inputs).find((input) => {
    const normalized = normalizePath(input);
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  });

const includesNodePackage = (inputs: Metafile["inputs"], packageName: string): boolean => {
  const marker = `node_modules/${packageName}/`;
  return Object.keys(inputs).some((input) => normalizePath(input).includes(marker));
};

const runBuild = (options: BuildOptions) =>
  Effect.tryPromise({
    try: () =>
      build({ ...options, bundle: true, platform: "browser", format: "esm", logLevel: "silent" }),
    catch: (cause) => new SmokeCheckError({ cause, message: "esbuild build failed" }),
  });

const metafileOf = (result: { readonly metafile?: Metafile | undefined }) =>
  result.metafile === undefined
    ? Effect.fail(
        new SmokeCheckError({
          cause: undefined,
          message: "esbuild did not return a metafile",
        }),
      )
    : Effect.succeed(result.metafile);

const fail = (message: string) => Effect.fail(new SmokeCheckError({ cause: undefined, message }));

const checkDurable = (outfile: string) =>
  Effect.gen(function* () {
    const durableInputs = (yield* metafileOf(
      yield* runBuild({
        entryPoints: ["scripts/durable-browser-smoke-entry.ts"],
        metafile: true,
        outfile,
        write: false,
      }),
    )).inputs;
    for (const expectedInput of [
      "libs/durable/src/index.ts",
      "libs/durable/src/env/index.ts",
      "libs/durable/src/storage/jsonl/index.ts",
      "libs/durable/src/storage/jsonl/storage.ts",
      "libs/durable/src/storage/memory.ts",
      "libs/durable/src/storage/sqlite/index.ts",
      "libs/durable/src/storage/sqlite/storage.ts",
    ]) {
      if (findInput(durableInputs, expectedInput) === undefined) {
        return yield* fail(`Durable browser bundle does not include ${expectedInput}`);
      }
    }
    for (const forbiddenInput of [
      "libs/durable/src/env/node.ts",
      "libs/durable/src/storage/jsonl/node.ts",
      "libs/durable/src/storage/sqlite/node.ts",
    ]) {
      const nodeAdapter = findInput(durableInputs, forbiddenInput);
      if (nodeAdapter !== undefined) {
        return yield* fail(`Durable browser bundle unexpectedly includes ${nodeAdapter}`);
      }
    }
  });

const describeFound = (found: ReadonlyArray<string>): string =>
  found.length > 0 ? found.join(", ") : "none";

const checkTreeshakeInputs = (inputs: Metafile["inputs"]) =>
  Effect.gen(function* () {
    for (const forbiddenInput of [
      "libs/ai/src/compat.ts",
      "libs/ai/src/models.generated.ts",
      "libs/ai/src/providers/all.ts",
    ]) {
      const includedInput = findInput(inputs, forbiddenInput);
      if (includedInput !== undefined) {
        return yield* fail(
          `Agent selective-provider bundle unexpectedly includes ${includedInput}`,
        );
      }
    }
    const includedAiSdkPackages = ["@anthropic-ai/sdk", "@google/genai", "openai"].filter(
      (packageName) => includesNodePackage(inputs, packageName),
    );
    if (includedAiSdkPackages.length !== 1 || includedAiSdkPackages[0] !== "@anthropic-ai/sdk") {
      return yield* fail(
        `Agent selective-provider bundle SDKs: expected only @anthropic-ai/sdk, found ${describeFound(includedAiSdkPackages)}`,
      );
    }
  });

const checkTreeshakeCatalogs = (metafile: Metafile) =>
  Effect.gen(function* () {
    const contributingInputs = new Set(
      Object.values(metafile.outputs).flatMap((output) =>
        Object.entries(output.inputs)
          .filter(([, contribution]) => contribution.bytesInOutput > 0)
          .map(([input]) => input),
      ),
    );
    const catalogInputs = [...contributingInputs].filter((input) =>
      normalizePath(input).includes("libs/ai/src/providers/data/"),
    );
    const [onlyCatalog] = catalogInputs;
    if (
      catalogInputs.length !== 1 ||
      onlyCatalog === undefined ||
      !normalizePath(onlyCatalog).endsWith("/anthropic.json")
    ) {
      return yield* fail(
        `Agent selective-provider bundle catalogs: expected only anthropic.json, found ${describeFound(catalogInputs)}`,
      );
    }
  });

const checkAgentTreeshake = (outfile: string, plugin: Plugin) =>
  Effect.gen(function* () {
    const metafile = yield* metafileOf(
      yield* runBuild({
        entryPoints: ["scripts/agent-treeshake-smoke-entry.ts"],
        metafile: true,
        outfile,
        plugins: [plugin],
        write: false,
      }),
    );
    yield* checkTreeshakeInputs(metafile.inputs);
    yield* checkTreeshakeCatalogs(metafile);
  });

interface EsbuildMessage {
  readonly location?: {
    readonly column: number;
    readonly file: string;
    readonly line: number;
  } | null;
  readonly text: string;
}

const hasErrors = (value: unknown): value is { readonly errors: ReadonlyArray<EsbuildMessage> } =>
  typeof value === "object" && value !== null && "errors" in value && Array.isArray(value.errors);

const describeFailure = (error: SmokeCheckError): string => {
  const cause = error.cause ?? new Error(error.message);
  const detailedErrors = hasErrors(cause)
    ? cause.errors
        .map((entry) => {
          const location =
            entry.location === undefined || entry.location === null
              ? ""
              : `${entry.location.file}:${entry.location.line}:${entry.location.column}`;
          return [location, entry.text].filter((part) => part !== "").join(" ");
        })
        .join("\n")
    : "";
  const baseError = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  return [detailedErrors, baseError].filter((part) => part !== "").join("\n\n");
};

const program = Effect.gen(function* () {
  const host = yield* Host;
  const outputPath = host.join(tmpdir(), "msa-browser-smoke.js");
  const durableOutputPath = host.join(tmpdir(), "msa-durable-browser-smoke.js");
  const agentTreeshakeOutputPath = host.join(tmpdir(), "msa-agent-treeshake-smoke.js");
  const errorLogPath = host.join(tmpdir(), "msa-browser-smoke-errors.log");
  const plugin = generatedCatalogDataPlugin(
    host,
    host.join(process.cwd(), "libs/ai/src/providers/data"),
  );

  return yield* Effect.gen(function* () {
    yield* runBuild({
      entryPoints: ["scripts/browser-smoke-entry.ts"],
      outfile: outputPath,
      plugins: [plugin],
    });
    yield* checkDurable(durableOutputPath);
    yield* checkAgentTreeshake(agentTreeshakeOutputPath, plugin);
    return yield* Effect.sync(() => process.exit(0));
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* host.writeText(errorLogPath, describeFailure(error));
        yield* Console.error(`Browser smoke check failed. See ${errorLogPath}`);
        return yield* Effect.sync(() => process.exit(1));
      }),
    ),
  );
});

runScript(program);
