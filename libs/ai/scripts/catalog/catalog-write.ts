import { Effect } from "effect";

import scriptOutput from "../../src/utils/script-output.ts";
import modelData from "../model-data.ts";
import scriptFiles from "../script-files.ts";
import type scriptFilesTypes from "../script-files.types.ts";
import catalogSources from "./catalog-sources.ts";
import type catalogWriteTypes from "./catalog-write.types.ts";

const {
  MODEL_DATA_MANIFEST_FILE,
  createModelDataManifest,
  validateGeneratedModelData,
  validateModelDataDirectory,
} = modelData;
const { ScriptFiles } = scriptFiles;
const { providerShardFile, renderAggregator, renderProviderShard } = catalogSources;

interface CatalogPaths {
  readonly providersDir: string;
  readonly aggregatorPath: string;
  readonly dataDir: string;
  readonly stagedDataDir: string;
  readonly previousDataDir: string;
}

const stageModelData = Effect.fn("stageModelData")(function* (
  request: catalogWriteTypes.CatalogWrite,
  stagedDataDir: string,
) {
  const files = yield* ScriptFiles;
  yield* files.makeDirectory(stagedDataDir);
  const fileContents: Record<string, string> = {};
  for (const providerId of request.grouped.providerIds) {
    const filename = `${providerId}.json`;
    const content = yield* request.serialize(request.grouped.groups[providerId]);
    fileContents[filename] = content;
    yield* files.writeTextFile({ content, path: files.join(stagedDataDir, filename) });
  }
  const { structure } = request.grouped;
  const manifest = yield* createModelDataManifest(structure, fileContents, request.generatedAt);
  yield* files.writeTextFile({
    content: yield* request.serialize(manifest),
    path: files.join(stagedDataDir, MODEL_DATA_MANIFEST_FILE),
  });
  yield* validateModelDataDirectory(structure, stagedDataDir);
});

const shardFiles = (files: scriptFilesTypes.ScriptFiles["Service"], providersDir: string) =>
  Effect.map(files.list(providersDir), (entries) =>
    entries.filter((entry) => entry.endsWith(".models.ts")),
  );

const snapshotTypeScriptCatalog = Effect.fn("snapshotTypeScriptCatalog")(function* (
  paths: CatalogPaths,
) {
  const files = yield* ScriptFiles;
  const shards = yield* Effect.forEach(yield* shardFiles(files, paths.providersDir), (entry) =>
    Effect.map(files.readText(files.join(paths.providersDir, entry)), (content) => ({
      content,
      entry,
    })),
  );
  const aggregator = yield* files.readText(paths.aggregatorPath);
  const restore = Effect.gen(function* () {
    for (const entry of yield* shardFiles(files, paths.providersDir))
      yield* files.remove(files.join(paths.providersDir, entry));
    for (const { entry, content } of shards)
      yield* files.writeTextFile({ content, path: files.join(paths.providersDir, entry) });
    yield* files.writeTextFile({ content: aggregator, path: paths.aggregatorPath });
  }).pipe(Effect.ignore);
  return { restore };
});

const writeTypeScriptCatalog = Effect.fn("writeTypeScriptCatalog")(function* (
  paths: CatalogPaths,
  providerIds: readonly string[],
) {
  const files = yield* ScriptFiles;
  const generated = new Set(providerIds.map(providerShardFile));
  for (const providerId of providerIds) {
    yield* files.writeTextFile({
      content: renderProviderShard(providerId),
      path: files.join(paths.providersDir, providerShardFile(providerId)),
    });
  }
  for (const entry of yield* shardFiles(files, paths.providersDir)) {
    if (!generated.has(entry)) yield* files.remove(files.join(paths.providersDir, entry));
  }
  yield* files.writeTextFile({
    content: renderAggregator(providerIds),
    path: paths.aggregatorPath,
  });
  yield* scriptOutput.print("Generated provider catalogs and src/models.generated.ts");
});

const swapModelData = Effect.fn("swapModelData")(function* (
  paths: CatalogPaths,
  packageRoot: string,
) {
  const files = yield* ScriptFiles;
  const hadPreviousData = yield* files.exists(paths.dataDir);
  if (hadPreviousData) yield* files.renamePath({ from: paths.dataDir, to: paths.previousDataDir });
  const restorePrevious = Effect.gen(function* () {
    yield* files.remove(paths.dataDir);
    if (hadPreviousData && (yield* files.exists(paths.previousDataDir)))
      yield* files.renamePath({ from: paths.previousDataDir, to: paths.dataDir });
  }).pipe(Effect.ignore);
  yield* Effect.onError(
    Effect.andThen(
      files.renamePath({ from: paths.stagedDataDir, to: paths.dataDir }),
      validateGeneratedModelData(packageRoot),
    ),
    () => restorePrevious,
  );
});

const replaceCatalog = Effect.fn("replaceCatalog")(function* (
  request: catalogWriteTypes.CatalogWrite,
  paths: CatalogPaths,
) {
  yield* stageModelData(request, paths.stagedDataDir);
  const publish = swapModelData(paths, request.packageRoot);
  if (request.dataOnly) {
    yield* publish;
  } else {
    const snapshot = yield* snapshotTypeScriptCatalog(paths);
    yield* Effect.onError(
      Effect.andThen(writeTypeScriptCatalog(paths, request.providerIds), publish),
      () => snapshot.restore,
    );
  }
  yield* scriptOutput.print(
    request.dataOnly
      ? "Hydrated JSON model values under src/providers/data/"
      : "Generated JSON model values under src/providers/data/",
  );
});

const writeGeneratedCatalog = Effect.fn("writeGeneratedCatalog")(function* (
  request: catalogWriteTypes.CatalogWrite,
) {
  const files = yield* ScriptFiles;
  const providersDir = files.join(request.packageRoot, "src", "providers");
  const stagingRoot = yield* files.makeTempDirectory({
    directory: providersDir,
    prefix: ".model-generation-",
  });
  const paths: CatalogPaths = {
    aggregatorPath: files.join(request.packageRoot, "src", "models.generated.ts"),
    dataDir: files.join(providersDir, "data"),
    previousDataDir: files.join(stagingRoot, "previous-data"),
    providersDir,
    stagedDataDir: files.join(stagingRoot, "data"),
  };
  yield* Effect.ensuring(replaceCatalog(request, paths), Effect.ignore(files.remove(stagingRoot)));
});

export default writeGeneratedCatalog;
