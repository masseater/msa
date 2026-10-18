import { Data, Effect, Function } from "effect";
import { Hex } from "effect/encoding";

import { digest } from "../src/utils/crypto.ts";
import { decodeJson, encodeJson } from "../src/utils/json-codec.ts";
import {
  apiPlacementErrors,
  groupedModelErrors,
  isRecord,
  listMismatch,
  manifestErrors,
  sortedRecord,
  structureFromGroups,
} from "./model-data-checks.ts";
import { type ScriptFileError, ScriptFiles } from "./script-files.ts";

export const MODEL_DATA_SCHEMA_VERSION = 6;
export const MODEL_DATA_MANIFEST_FILE = ".manifest.json";

export type ModelDataStructure = Record<string, Record<string, string>>;

export class ModelDataError extends Data.TaggedError("ModelDataError")<{
  readonly message: string;
}> {}

export interface ModelDataManifest {
  schemaVersion: number;
  generatedAt: string;
  structureHash: string;
  files: Record<string, string>;
}

const MODEL_DATA_IMPORT_PATTERN =
  /^import \{ [A-Z][A-Z0-9_]*_CLASSIFIER_MODELS, [A-Z][A-Z0-9_]*_IMAGE_MODELS, [A-Z][A-Z0-9_]*_MODELS \} from "\.\/providers\/([^"/]+)\.models\.ts";$/gmu;

const fail = (message: string) => Effect.fail(new ModelDataError({ message }));

const sha256 = (value: string): Effect.Effect<string> =>
  Effect.map(digest("SHA-256", new TextEncoder().encode(value)), Hex.encode);

export const assertExactModelIds: {
  (expected: Iterable<string>, actual: Iterable<string>): (label: string) => void;
  (label: string, expected: Iterable<string>, actual: Iterable<string>): void;
} = Function.dual(
  3,
  function (label: string, expected: Iterable<string>, actual: Iterable<string>): void {
    const [message] = listMismatch(`${label} model IDs do not match`)({
      expected: Array.from(new Set(expected)).sort(),
      actual: Array.from(new Set(actual)).sort(),
    });
    if (message !== undefined) throw new Error(message);
  },
);

const readJsonObject = Effect.fn("readJsonObject")(function* (path: string, description: string) {
  const files = yield* ScriptFiles;
  const parsed = yield* files.readText(path).pipe(
    Effect.flatMap(decodeJson),
    Effect.mapError(
      (error) =>
        new ModelDataError({ message: `${description} is not valid JSON: ${error.message}` }),
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
  const result = structureFromGroups({ path, groups });
  if ("error" in result) return yield* fail(result.error);
  return result.structure;
});

export const readModelDataProviderIds = Effect.fn("readModelDataProviderIds")(function* (
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

export const readModelDataStructure = Effect.fn("readModelDataStructure")(function* (
  packageRoot: string,
) {
  const files = yield* ScriptFiles;
  const providersDir = files.join(packageRoot, "src", "providers");
  const providerIds = yield* readModelDataProviderIds(packageRoot);
  const [message] = listMismatch("Generated model aggregator and provider shards do not match")({
    expected: providerIds.map((providerId) => `${providerId}.models.ts`).sort(),
    actual: (yield* files.list(providersDir))
      .filter((entry) => entry.endsWith(".models.ts"))
      .sort(),
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

export const modelDataStructureHash = (structure: ModelDataStructure): Effect.Effect<string> =>
  encodeJson(
    sortedRecord(
      Object.entries(structure).map(
        ([providerId, models]) => [providerId, sortedRecord(Object.entries(models))] as const,
      ),
    ),
  ).pipe(Effect.flatMap(sha256));

export const createModelDataManifest: {
  (
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ): (structure: ModelDataStructure) => Effect.Effect<ModelDataManifest>;
  (
    structure: ModelDataStructure,
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ): Effect.Effect<ModelDataManifest>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    structure: ModelDataStructure,
    fileContents: Readonly<Record<string, string>>,
    generatedAt: string,
  ) {
    const hashes = yield* Effect.forEach(Object.entries(fileContents), ([file, content]) =>
      Effect.map(sha256(content), (hash) => [file, hash] as const),
    );
    return {
      schemaVersion: MODEL_DATA_SCHEMA_VERSION,
      generatedAt,
      structureHash: yield* modelDataStructureHash(structure),
      files: sortedRecord(hashes),
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
  const grouped = groupedModelErrors({ providerId, filename, groups });
  return [
    ...errors,
    ...grouped.errors,
    ...listMismatch(`${filename} model IDs do not match the generated catalog`)({
      expected: Object.keys(expectedModels).sort(),
      actual: Array.from(grouped.actualModels.keys()).sort(),
    }),
    ...apiPlacementErrors({ providerId, expectedModels, actualModels: grouped.actualModels }),
  ];
});

function validationFailure(errors: readonly string[]): ModelDataError {
  const visible = errors.slice(0, 30);
  const suffix =
    errors.length > visible.length ? `\n  ... and ${errors.length - visible.length} more` : "";
  return new ModelDataError({
    message: `Invalid generated model data:\n${visible.map((error) => `  - ${error}`).join("\n")}${suffix}`,
  });
}

export const validateModelDataDirectory: {
  (
    dataDir: string,
  ): (
    structure: ModelDataStructure,
  ) => Effect.Effect<void, ModelDataError | ScriptFileError, ScriptFiles>;
  (
    structure: ModelDataStructure,
    dataDir: string,
  ): Effect.Effect<void, ModelDataError | ScriptFileError, ScriptFiles>;
} = Function.dual(
  2,
  Effect.fnUntraced(function* (structure: ModelDataStructure, dataDir: string) {
    const files = yield* ScriptFiles;
    if (!(yield* files.isDirectory(dataDir)))
      return yield* fail(`Generated model data directory does not exist: ${dataDir}`);
    const expectedFiles = Object.keys(structure)
      .map((providerId) => `${providerId}.json`)
      .sort();
    const errors = listMismatch("provider data files do not match the generated catalog")({
      expected: expectedFiles,
      actual: (yield* files.list(dataDir))
        .filter((entry) => entry.endsWith(".json") && entry !== MODEL_DATA_MANIFEST_FILE)
        .sort(),
    });
    const manifestPath = files.join(dataDir, MODEL_DATA_MANIFEST_FILE);
    const manifest = yield* collectJsonObject(manifestPath, "model data manifest", errors);
    errors.push(
      ...manifestErrors({
        manifest,
        schemaVersion: MODEL_DATA_SCHEMA_VERSION,
        structureHash: yield* modelDataStructureHash(structure),
        expectedFiles,
      }),
    );
    const hashes = manifest?.["files"];
    const manifestFiles = isRecord(hashes) ? hashes : undefined;
    for (const entry of Object.entries(structure))
      errors.push(...(yield* providerFileErrors(entry, dataDir, manifestFiles)));
    if (errors.length > 0) return yield* validationFailure(errors);
  }),
);

export const validateGeneratedModelData = Effect.fn("validateGeneratedModelData")(function* (
  packageRoot: string,
) {
  const structure = yield* readModelDataStructure(packageRoot);
  const files = yield* ScriptFiles;
  yield* validateModelDataDirectory(structure, files.join(packageRoot, "src", "providers", "data"));
});

export interface ModelCatalogEntry {
  type: string;
  id: string;
  api: string;
}

export interface ProviderModelData<T extends ModelCatalogEntry> {
  readonly groups: Record<string, Record<string, T>>;
  readonly structure: Record<string, string>;
}

export const groupProviderModelData: {
  <T extends ModelCatalogEntry>(
    models: readonly T[],
  ): (providerId: string) => Effect.Effect<ProviderModelData<T>, ModelDataError>;
  <T extends ModelCatalogEntry>(
    providerId: string,
    models: readonly T[],
  ): Effect.Effect<ProviderModelData<T>, ModelDataError>;
} = Function.dual(2, function <
  T extends ModelCatalogEntry,
>(providerId: string, models: readonly T[]): Effect.Effect<ProviderModelData<T>, ModelDataError> {
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
