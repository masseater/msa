import { Console, Effect } from "effect";

import {
  createModelDataManifest,
  MODEL_DATA_MANIFEST_FILE,
  validateGeneratedModelData,
  validateModelDataDirectory,
} from "../model-data.ts";
import { ScriptFiles } from "../script-files.ts";
import type { GroupedCatalog } from "./catalog-data.ts";
import { providerShardFile, renderAggregator, renderProviderShard } from "./catalog-sources.ts";

export interface CatalogWrite {
  readonly packageRoot: string;
  readonly providerIds: readonly string[];
  readonly grouped: GroupedCatalog;
  readonly generatedAt: string;
  readonly dataOnly: boolean;
  readonly serialize: (value: unknown) => Effect.Effect<string>;
}

interface CatalogPaths {
  readonly providersDir: string;
  readonly aggregatorPath: string;
  readonly dataDir: string;
  readonly stagedDataDir: string;
  readonly previousDataDir: string;
}

const stageModelData = Effect.fn("stageModelData")(function* (
  request: CatalogWrite,
  stagedDataDir: string,
) {
  const files = yield* ScriptFiles;
  yield* files.makeDirectory(stagedDataDir);
  const fileContents: Record<string, string> = {};
  for (const providerId of request.grouped.providerIds) {
    const filename = `${providerId}.json`;
    const content = yield* request.serialize(request.grouped.groups[providerId]);
    fileContents[filename] = content;
    yield* files.writeText({ path: files.join(stagedDataDir, filename), content });
  }
  const { structure } = request.grouped;
  const manifest = yield* createModelDataManifest(structure, fileContents, request.generatedAt);
  yield* files.writeText({
    path: files.join(stagedDataDir, MODEL_DATA_MANIFEST_FILE),
    content: yield* request.serialize(manifest),
  });
  yield* validateModelDataDirectory(structure, stagedDataDir);
});

const shardFiles = (files: ScriptFiles["Service"], providersDir: string) =>
  Effect.map(files.list(providersDir), (entries) =>
    entries.filter((entry) => entry.endsWith(".models.ts")),
  );

const snapshotTypeScriptCatalog = Effect.fn("snapshotTypeScriptCatalog")(function* (
  paths: CatalogPaths,
) {
  const files = yield* ScriptFiles;
  const shards = yield* Effect.forEach(yield* shardFiles(files, paths.providersDir), (entry) =>
    Effect.map(files.readText(files.join(paths.providersDir, entry)), (content) => ({
      entry,
      content,
    })),
  );
  const aggregator = yield* files.readText(paths.aggregatorPath);
  const restore = Effect.gen(function* () {
    for (const entry of yield* shardFiles(files, paths.providersDir))
      yield* files.remove(files.join(paths.providersDir, entry));
    for (const { entry, content } of shards)
      yield* files.writeText({ path: files.join(paths.providersDir, entry), content });
    yield* files.writeText({ path: paths.aggregatorPath, content: aggregator });
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
    yield* files.writeText({
      path: files.join(paths.providersDir, providerShardFile(providerId)),
      content: renderProviderShard(providerId),
    });
  }
  for (const entry of yield* shardFiles(files, paths.providersDir)) {
    if (!generated.has(entry)) yield* files.remove(files.join(paths.providersDir, entry));
  }
  yield* files.writeText({ path: paths.aggregatorPath, content: renderAggregator(providerIds) });
  yield* Console.log("Generated provider catalogs and src/models.generated.ts");
});

const swapModelData = Effect.fn("swapModelData")(function* (
  paths: CatalogPaths,
  packageRoot: string,
) {
  const files = yield* ScriptFiles;
  const hadPreviousData = yield* files.exists(paths.dataDir);
  if (hadPreviousData) yield* files.rename({ from: paths.dataDir, to: paths.previousDataDir });
  const restorePrevious = Effect.gen(function* () {
    yield* files.remove(paths.dataDir);
    if (hadPreviousData && (yield* files.exists(paths.previousDataDir)))
      yield* files.rename({ from: paths.previousDataDir, to: paths.dataDir });
  }).pipe(Effect.ignore);
  yield* Effect.onError(
    Effect.andThen(
      files.rename({ from: paths.stagedDataDir, to: paths.dataDir }),
      validateGeneratedModelData(packageRoot),
    ),
    () => restorePrevious,
  );
});

const replaceCatalog = Effect.fn("replaceCatalog")(function* (
  request: CatalogWrite,
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
  yield* Console.log(
    request.dataOnly
      ? "Hydrated JSON model values under src/providers/data/"
      : "Generated JSON model values under src/providers/data/",
  );
});

export const writeGeneratedCatalog = Effect.fn("writeGeneratedCatalog")(function* (
  request: CatalogWrite,
) {
  const files = yield* ScriptFiles;
  const providersDir = files.join(request.packageRoot, "src", "providers");
  const stagingRoot = yield* files.makeTempDirectory({
    directory: providersDir,
    prefix: ".model-generation-",
  });
  const paths: CatalogPaths = {
    providersDir,
    aggregatorPath: files.join(request.packageRoot, "src", "models.generated.ts"),
    dataDir: files.join(providersDir, "data"),
    stagedDataDir: files.join(stagingRoot, "data"),
    previousDataDir: files.join(stagingRoot, "previous-data"),
  };
  yield* Effect.ensuring(replaceCatalog(request, paths), Effect.ignore(files.remove(stagingRoot)));
});
