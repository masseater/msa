import { Effect, Function } from "effect";
import { Hex } from "effect/encoding";

import cryptoModule from "../src/utils/crypto.ts";
import jsonCodec from "../src/utils/json-codec.ts";
import modelDataChecks from "./model-data-checks.ts";
import ModelDataError from "./model-data-error.ts";
import type modelDataTypes from "./model-data.types.ts";
import ScriptFileError from "./script-file-error.ts";
import scriptFiles from "./script-files.ts";
import type scriptFilesTypes from "./script-files.types.ts";

const { digest } = cryptoModule;
const { decodeJson, encodeJson } = jsonCodec;
const {
  apiPlacementErrors,
  groupedModelErrors,
  isRecord,
  listMismatch,
  manifestErrors,
  sortedRecord,
  structureFromGroups,
} = modelDataChecks;
const { ScriptFiles } = scriptFiles;

const MODEL_DATA_SCHEMA_VERSION = 6;
const MODEL_DATA_MANIFEST_FILE = ".manifest.json";
const MODEL_DATA_IMPORT_PATTERN =
  /^import \w+Models from "\.\/providers\/([^"/]+)\.models\.ts";$/gmu;
const fail = (message: string) => Effect.fail(ModelDataError.make({ message }));
const sha256 = (value: string): Effect.Effect<string> =>
  Effect.map(digest("SHA-256", new TextEncoder().encode(value)), Hex.encode);
const readJsonObject = Effect.fn("readJsonObject")(function* (path: string, description: string) {
  const files = yield* ScriptFiles;
  const parsed = yield* files.readText(path).pipe(
    Effect.flatMap(decodeJson),
    Effect.mapError((error) =>
      ModelDataError.make({ message: `${description} is not valid JSON: ${error.message}` }),
    ),
  );
  if (!isRecord(parsed)) return yield* fail(`${description} must contain a JSON object`);
  return parsed;
});
const collectJsonObject = (path: string, description: string, errors: string[]) =>
  readJsonObject(path, description).pipe(
    Effect.catchTag("ModelDataError", (error) =>
      Effect.sync(() => {
        errors.push(error.message);
        return undefined;
      }),
    ),
  );
const readProviderStructure = Effect.fn("readProviderStructure")(function* (
  path: string,
  providerId: string,
) {
  const groups = yield* readJsonObject(path, `${providerId}.json`);
  const result = structureFromGroups({ groups, path });
  if ("error" in result) return yield* fail(result.error);
  return result.structure;
});
const readModelDataProviderIds = Effect.fn("readModelDataProviderIds")(function* (
  packageRoot: string,
) {
  const files = yield* ScriptFiles;
  const aggregatorPath = files.join(packageRoot, "src", "models.generated.ts");
  const aggregator = yield* files.readText(aggregatorPath);
  const providerIds = Array.from(aggregator.matchAll(MODEL_DATA_IMPORT_PATTERN))
    .flatMap(([, providerId]) => (providerId === undefined ? [] : [providerId]))
    .sort();
  if (providerIds.length === 0)
    return yield* fail(`No generated provider imports found in ${aggregatorPath}`);
  if (new Set(providerIds).size !== providerIds.length) {
    return yield* fail(
      `Generated model aggregator contains duplicate provider imports: ${aggregatorPath}`,
    );
  }
  return providerIds;
});
const readModelDataStructure = Effect.fn("readModelDataStructure")(function* (packageRoot: string) {
  const files = yield* ScriptFiles;
  const providersDir = files.join(packageRoot, "src", "providers");
  const providerIds = yield* readModelDataProviderIds(packageRoot);
  const [message] = listMismatch("Generated model aggregator and provider shards do not match")({
    actual: (yield* files.list(providersDir))
      .filter((entry) => entry.endsWith(".models.ts"))
      .sort(),
    expected: providerIds.map((providerId) => `${providerId}.models.ts`).sort(),
  });
  if (message !== undefined) return yield* fail(message);
  const structures = yield* Effect.forEach(providerIds, (providerId) =>
    Effect.map(
      readProviderStructure(files.join(providersDir, "data", `${providerId}.json`), providerId),
      (structure) => [providerId, structure] as const,
    ),
  );
  return sortedRecord(structures);
});
const modelDataStructureHash = (
  structure: modelDataTypes.ModelDataStructure,
): Effect.Effect<string> =>
  encodeJson(
    sortedRecord(
      Object.entries(structure).map(
        ([providerId, models]) => [providerId, sortedRecord(Object.entries(models))] as const,
      ),
    ),
  ).pipe(Effect.flatMap(sha256));
const createModelDataManifest: {
  (
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ): (
    structure: modelDataTypes.ModelDataStructure,
  ) => Effect.Effect<modelDataTypes.ModelDataManifest>;
  (
    structure: modelDataTypes.ModelDataStructure,
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ): Effect.Effect<modelDataTypes.ModelDataManifest>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    structure: modelDataTypes.ModelDataStructure,
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ) {
    const hashes = yield* Effect.forEach(Object.entries(fileContents), ([file, content]) =>
      Effect.map(sha256(content), (hash) => [file, hash] as const),
    );
    return {
      files: sortedRecord(hashes),
      generatedAt,
      schemaVersion: MODEL_DATA_SCHEMA_VERSION,
      structureHash: yield* modelDataStructureHash(structure),
    };
  }),
);
const providerFileErrors = Effect.fn("providerFileErrors")(function* (
  [providerId, expectedModels]: readonly [string, Readonly<Record<string, string>>],
  dataDir: string,
  manifestFiles: Readonly<Record<string, unknown>> | undefined,
) {
  const files = yield* ScriptFiles;
  const path = files.join(dataDir, `${providerId}.json`);
  const filename = `${providerId}.json`;
  if (!(yield* files.exists(path))) return [];
  const errors: string[] = [];
  const content = yield* files.readText(path);
  if (manifestFiles !== undefined && manifestFiles[filename] !== (yield* sha256(content)))
    errors.push(`${filename} does not match its manifest hash`);
  const groups = yield* collectJsonObject(path, filename, errors);
  if (groups === undefined) return errors;
  const grouped = groupedModelErrors({ filename, groups, providerId });
  return [
    ...errors,
    ...grouped.errors,
    ...listMismatch(`${filename} model IDs do not match the generated catalog`)({
      actual: Array.from(grouped.actualModels.keys()).sort(),
      expected: Object.keys(expectedModels).sort(),
    }),
    ...apiPlacementErrors({ actualModels: grouped.actualModels, expectedModels, providerId }),
  ];
});
function validationFailure(errors: readonly string[]): ModelDataError {
  const visible = errors.slice(0, 30);
  const suffix =
    errors.length > visible.length ? `\n  ... and ${errors.length - visible.length} more` : "";
  return ModelDataError.make({
    message: `Invalid generated model data:\n${visible.map((error) => `  - ${error}`).join("\n")}${suffix}`,
  });
}
const validateModelDataDirectory: {
  (
    dataDir: string,
  ): (
    structure: modelDataTypes.ModelDataStructure,
  ) => Effect.Effect<void, ModelDataError | ScriptFileError, scriptFilesTypes.ScriptFiles>;
  (
    structure: modelDataTypes.ModelDataStructure,
    dataDir: string,
  ): Effect.Effect<void, ModelDataError | ScriptFileError, scriptFilesTypes.ScriptFiles>;
} = Function.dual(
  2,
  Effect.fnUntraced(function* (structure: modelDataTypes.ModelDataStructure, dataDir: string) {
    const files = yield* ScriptFiles;
    if (!(yield* files.isDirectory(dataDir)))
      return yield* fail(`Generated model data directory does not exist: ${dataDir}`);
    const expectedFiles = Object.keys(structure)
      .map((providerId) => `${providerId}.json`)
      .sort();
    const errors = listMismatch("provider data files do not match the generated catalog")({
      actual: (yield* files.list(dataDir))
        .filter((entry) => entry.endsWith(".json") && entry !== MODEL_DATA_MANIFEST_FILE)
        .sort(),
      expected: expectedFiles,
    });
    const manifestPath = files.join(dataDir, MODEL_DATA_MANIFEST_FILE);
    const manifest = yield* collectJsonObject(manifestPath, "model data manifest", errors);
    errors.push(
      ...manifestErrors({
        expectedFiles,
        manifest,
        schemaVersion: MODEL_DATA_SCHEMA_VERSION,
        structureHash: yield* modelDataStructureHash(structure),
      }),
    );
    const hashes = manifest?.["files"];
    const manifestFiles = isRecord(hashes) ? hashes : undefined;
    for (const entry of Object.entries(structure))
      errors.push(...(yield* providerFileErrors(entry, dataDir, manifestFiles)));
    if (errors.length > 0) return yield* validationFailure(errors);
  }),
);
const validateGeneratedModelData = Effect.fn("validateGeneratedModelData")(function* (
  packageRoot: string,
) {
  const structure = yield* readModelDataStructure(packageRoot);
  const files = yield* ScriptFiles;
  yield* validateModelDataDirectory(structure, files.join(packageRoot, "src", "providers", "data"));
});
const groupProviderModelData: {
  <T extends modelDataTypes.ModelCatalogEntry>(
    models: readonly T[],
  ): (providerId: string) => Effect.Effect<modelDataTypes.ProviderModelData<T>, ModelDataError>;
  <T extends modelDataTypes.ModelCatalogEntry>(
    providerId: string,
    models: readonly T[],
  ): Effect.Effect<modelDataTypes.ProviderModelData<T>, ModelDataError>;
} = Function.dual(2, function <
  T extends modelDataTypes.ModelCatalogEntry,
>(providerId: string, models: readonly T[]): Effect.Effect<
  modelDataTypes.ProviderModelData<T>,
  ModelDataError
> {
  const groups: Record<string, Record<string, T>> = {};
  const structure: Record<string, string> = {};
  for (const api of Array.from(new Set(models.map((model) => model.api))).sort()) {
    const group: Record<string, T> = {};
    for (const model of models) {
      if (model.api !== api) continue;
      const identity = `${model.type}:${model.id}`;
      if (group[identity] !== undefined)
        return fail(`${providerId}/${identity} has duplicate ${api} catalog entries`);
      group[identity] = model;
      structure[identity] = api;
    }
    groups[api] = group;
  }
  return Effect.succeed({ groups, structure });
});

const modelData = {
  MODEL_DATA_MANIFEST_FILE,
  MODEL_DATA_SCHEMA_VERSION,
  createModelDataManifest,
  groupProviderModelData,
  modelDataStructureHash,
  readModelDataProviderIds,
  readModelDataStructure,
  validateGeneratedModelData,
  validateModelDataDirectory,
};

export default modelData;
