import { Effect, ManagedRuntime } from "effect";

import jsonCodec from "../src/utils/json-codec.ts";
import type hydrateModelCatalogTypes from "./hydrate-model-catalog.types.ts";
import modelDataChecks from "./model-data-checks.ts";
import ModelDataError from "./model-data-error.ts";
import modelData from "./model-data.ts";
import type modelDataTypes from "./model-data.types.ts";
import scriptFiles from "./script-files.ts";

const { decodeJson, encodeJson } = jsonCodec;

const { isRecord } = modelDataChecks;
const {
  MODEL_DATA_MANIFEST_FILE,
  createModelDataManifest,
  groupProviderModelData,
  readModelDataProviderIds,
  validateModelDataDirectory,
} = modelData;
const { ScriptFiles, scriptFilesLayer } = scriptFiles;

type CatalogEntry = modelDataTypes.ModelCatalogEntry & Record<string, unknown>;

interface HydratedCatalog {
  readonly files: Readonly<Record<string, string>>;
  readonly structure: modelDataTypes.ModelDataStructure;
}

const fail = (message: string) => Effect.fail(new ModelDataError({ message }));

function isCatalogEntry(value: unknown): value is CatalogEntry {
  return (
    isRecord(value) &&
    typeof value["type"] === "string" &&
    typeof value["id"] === "string" &&
    typeof value["api"] === "string" &&
    value["api"].length > 0
  );
}

const readCatalog = Effect.fn("readCatalog")(function* (catalogPath: string) {
  const files = yield* ScriptFiles;
  const catalog = yield* files.readText(catalogPath).pipe(
    Effect.flatMap(decodeJson),
    Effect.mapError((error) => new ModelDataError({ message: error.message })),
  );
  if (!isRecord(catalog)) return yield* fail("Model catalog must be an object");
  return catalog;
});

const providerEntries = Effect.fn("providerEntries")(function* (
  catalog: Record<string, unknown>,
  provider: string,
) {
  const models = catalog[provider];
  if (models === undefined) return yield* fail(`Model catalog is missing provider: ${provider}`);
  if (!Array.isArray(models) || models.length === 0)
    return yield* fail(`Model catalog has no typed model list for provider: ${provider}`);
  if (!models.every(isCatalogEntry))
    return yield* fail(`Model catalog has an invalid entry for provider ${provider}`);
  return models;
});

const groupCatalog = Effect.fn("groupCatalog")(function* (
  packageRoot: string,
  catalog: Record<string, unknown>,
) {
  const files: Record<string, string> = {};
  const structure: modelDataTypes.ModelDataStructure = {};
  for (const provider of yield* readModelDataProviderIds(packageRoot)) {
    const grouped = yield* groupProviderModelData(
      provider,
      yield* providerEntries(catalog, provider),
    );
    structure[provider] = grouped.structure;
    files[`${provider}.json`] = `${yield* encodeJson(grouped.groups)}\n`;
  }
  return { files, structure } satisfies HydratedCatalog;
});

const stageCatalog = Effect.fn("stageCatalog")(function* (
  { files: contents, structure }: HydratedCatalog,
  stagedData: string,
) {
  const files = yield* ScriptFiles;
  yield* files.makeDirectory(stagedData);
  for (const [name, content] of Object.entries(contents))
    yield* files.writeText({ content, path: files.join(stagedData, name) });
  const manifest = yield* createModelDataManifest(structure, contents, "1970-01-01T00:00:00.000Z");
  yield* files.writeText({
    content: `${yield* encodeJson(manifest)}\n`,
    path: files.join(stagedData, MODEL_DATA_MANIFEST_FILE),
  });
  yield* validateModelDataDirectory(structure, stagedData);
});

const hydrateModelCatalog = Effect.fn("hydrateModelCatalog")(function* ({
  packageRoot,
  catalogPath,
  validateOnly = false,
}: hydrateModelCatalogTypes.HydrateModelCatalogRequest) {
  const files = yield* ScriptFiles;
  const hydrated = yield* groupCatalog(packageRoot, yield* readCatalog(catalogPath));
  const providersDir = files.join(packageRoot, "src", "providers");
  const stagingRoot = yield* files.makeTempDirectory({
    directory: providersDir,
    prefix: ".model-hydration-",
  });
  const stagedData = files.join(stagingRoot, "data");
  yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* stageCatalog(hydrated, stagedData);
      if (validateOnly) return;
      const dataDir = files.join(providersDir, "data");
      yield* files.remove(dataDir);
      yield* files.rename({ from: stagedData, to: dataDir });
    }),
    Effect.ignore(files.remove(stagingRoot)),
  );
});

if (import.meta.main) {
  const [catalogPath, ...extraArgs] = process.argv.slice(2);
  if (catalogPath === undefined || extraArgs.length > 0)
    throw new Error("Usage: node hydrate-model-catalog.ts <models.all.json>");
  ManagedRuntime.make(scriptFilesLayer).runFork(
    Effect.gen(function* () {
      const files = yield* ScriptFiles;
      yield* hydrateModelCatalog({
        catalogPath: files.resolve(catalogPath),
        packageRoot: files.join(import.meta.dirname, ".."),
      });
    }),
  );
}

export default hydrateModelCatalog;
