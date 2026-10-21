import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import modelData from "../scripts/model-data.ts";
import type modelDataTypes from "../scripts/model-data.types.ts";
import scriptFiles from "../scripts/script-files.ts";
import jsonCodec from "../src/utils/json-codec.ts";
import modelDataFixture from "./model-data-fixture.ts";
import type modelDataFixtureTypes from "./model-data-fixture.types.ts";

const { decodeJsonOrDie } = jsonCodec;

const {
  MODEL_DATA_MANIFEST_FILE,
  MODEL_DATA_SCHEMA_VERSION,
  createModelDataManifest,
  readModelDataStructure,
  validateModelDataDirectory,
} = modelData;
const { ScriptFiles } = scriptFiles;
const {
  AGGREGATOR_SOURCE,
  GENERATED_AT,
  chatModel,
  createFixture,
  failureMessage,
  readFile,
  runScript,
  writeFile,
  writeFixtureData,
  writeJsonFile,
} = modelDataFixture;

const validationMessage = (fixture: modelDataFixtureTypes.ModelDataFixture) =>
  failureMessage(validateModelDataDirectory(fixture.structure, fixture.dataDir));

const rewriteManifest = (
  fixture: modelDataFixtureTypes.ModelDataFixture,
  field: string,
  value: unknown,
) =>
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    const manifestPath = files.join(fixture.dataDir, MODEL_DATA_MANIFEST_FILE);
    const manifest = yield* Effect.flatMap(readFile(manifestPath), decodeJsonOrDie);
    yield* writeJsonFile(manifestPath, {
      ...(manifest as Record<string, unknown>),
      [field]: value,
    });
  });

const readsAndValidatesAPIGroupedModel = () =>
  runScript(
    Effect.gen(function* () {
      const { dataDir, packageRoot, structure } = yield* createFixture;
      expect(yield* readModelDataStructure(packageRoot)).toEqual(structure);
      yield* validateModelDataDirectory(structure, dataDir);
    }),
  );

const rejectsAMissingModelDataDirectory = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      yield* ScriptFiles.use((files) => files.remove(fixture.dataDir));
      expect(yield* validationMessage(fixture)).toContain("does not exist");
    }),
  );

const rejectsMissingProviderShardsImportedBy = () =>
  runScript(
    Effect.gen(function* () {
      const { packageRoot } = yield* createFixture;
      const files = yield* ScriptFiles;
      yield* writeFile(
        files.join(packageRoot, "src", "models.generated.ts"),
        `${AGGREGATOR_SOURCE}import missingModels from "./providers/missing.models.ts";\n`,
      );
      expect(yield* failureMessage(readModelDataStructure(packageRoot))).toContain(
        "aggregator and provider shards do not match",
      );
    }),
  );

describe("generated model data structure", () => {
  it("reads and validates API-grouped model data", readsAndValidatesAPIGroupedModel);

  it("rejects a missing model data directory", rejectsAMissingModelDataDirectory);

  it(
    "rejects missing provider shards imported by the aggregator",
    rejectsMissingProviderShardsImportedBy,
  );
});

const rejectsAModelWithoutAKnown = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      delete chatModel(fixture.values)["type"];
      yield* writeFixtureData(fixture);
      expect(yield* validationMessage(fixture)).toContain(
        'expected "chat", "image", or "classifier"',
      );
    }),
  );

const rejectsOutputModalitiesOnChatModels = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      chatModel(fixture.values)["output"] = ["text"];
      yield* writeFixtureData(fixture);
      expect(yield* validationMessage(fixture)).toContain("unsupported output modalities");
    }),
  );

describe("generated model value validation", () => {
  it.each([
    ["id", "wrong-id", "has id"],
    ["provider", "wrong-provider", "has provider"],
    ["api", "anthropic-messages", "has api"],
  ] as const)("rejects a wrong model %s", (field, value, expectedMessage) =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        chatModel(fixture.values)[field] = value;
        yield* writeFixtureData(fixture);
        expect(yield* validationMessage(fixture)).toContain(expectedMessage);
      }),
    ),
  );

  it("rejects a model without a known type", rejectsAModelWithoutAKnown);

  it("rejects output modalities on chat models", rejectsOutputModalitiesOnChatModels);
});

const validatesImageModelsWithOutputModalities = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      const structure: modelDataTypes.ModelDataStructure = {
        "test-provider": { "image:image-a": "test-images" },
      };
      const image: Record<string, unknown> = {
        api: "test-images",
        baseUrl: "https://example.test/v1",
        cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 },
        id: "image-a",
        input: ["text"],
        name: "Image A",
        output: ["image", "text"],
        provider: "test-provider",
        type: "image",
      };
      const validate = Effect.andThen(
        Effect.suspend(() =>
          writeFixtureData({
            apiGroup: "test-images",
            dataDir: fixture.dataDir,
            structure,
            values: { "image:image-a": image },
          }),
        ),
        validateModelDataDirectory(structure, fixture.dataDir),
      );
      yield* validate;

      delete image["output"];
      expect(yield* failureMessage(validate)).toContain("invalid output modalities");
      image["output"] = ["text"];
      expect(yield* failureMessage(validate)).toContain("invalid output modalities");
    }),
  );

const validatesClassifierModelsWithoutChatOutput = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      const structure: modelDataTypes.ModelDataStructure = {
        "test-provider": { "classifier:classifier-a": "test-classifier" },
      };
      yield* writeFixtureData({
        apiGroup: "test-classifier",
        dataDir: fixture.dataDir,
        structure,
        values: {
          "classifier:classifier-a": {
            api: "test-classifier",
            baseUrl: "https://example.test/v1",
            contextWindow: 1000,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
            id: "classifier-a",
            input: ["text"],
            name: "Classifier A",
            provider: "test-provider",
            type: "classifier",
          },
        },
      });
      yield* validateModelDataDirectory(structure, fixture.dataDir);
    }),
  );

describe("generated image and classifier validation", () => {
  it(
    "validates image models with output modalities and without chat limits",
    validatesImageModelsWithOutputModalities,
  );

  it(
    "validates classifier models without chat output limits",
    validatesClassifierModelsWithoutChatOutput,
  );
});

const rejectsAModelInTheWrong = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      yield* writeFixtureData({ ...fixture, apiGroup: "anthropic-messages" });
      expect(yield* validationMessage(fixture)).toContain("grouped under API");
    }),
  );

const rejectsDuplicateModelIDsAcrossAPI = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      const files = yield* ScriptFiles;
      const filename = "test-provider.json";
      const groups = {
        "anthropic-messages": fixture.values,
        "openai-completions": fixture.values,
      };
      yield* writeJsonFile(files.join(fixture.dataDir, filename), groups);
      const content = yield* readFile(files.join(fixture.dataDir, filename));
      const manifest = yield* createModelDataManifest(
        fixture.structure,
        { [filename]: content },
        GENERATED_AT,
      );
      yield* writeJsonFile(files.join(fixture.dataDir, MODEL_DATA_MANIFEST_FILE), manifest);
      expect(yield* validationMessage(fixture)).toContain("more than one API group");
    }),
  );

describe("generated model grouping validation", () => {
  it("rejects a model in the wrong API group", rejectsAModelInTheWrong);

  it("rejects duplicate model IDs across API groups", rejectsDuplicateModelIDsAcrossAPI);
});

const rejectsMissingModelIDsAndStale = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      const files = yield* ScriptFiles;
      yield* writeFile(files.join(fixture.dataDir, "test-provider.json"), "{}\n");
      expect(yield* validationMessage(fixture)).toMatch(/manifest hash|model IDs/u);
    }),
  );

const rejectsIncompatibleSchemaAndGenerationStamps = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      yield* writeFixtureData({ ...fixture, schemaVersion: MODEL_DATA_SCHEMA_VERSION + 1 });
      expect(yield* validationMessage(fixture)).toContain("model data schema");
      yield* rewriteManifest(fixture, "structureHash", "stale");
      expect(yield* validationMessage(fixture)).toContain("generation stamp");
    }),
  );

const rejectsAnInvalidGenerationTimestamp = () =>
  runScript(
    Effect.gen(function* () {
      const fixture = yield* createFixture;
      yield* rewriteManifest(fixture, "generatedAt", "invalid");
      expect(yield* validationMessage(fixture)).toContain("generation timestamp");
    }),
  );

describe("generated model manifest validation", () => {
  it("rejects missing model IDs and stale file hashes", rejectsMissingModelIDsAndStale);

  it(
    "rejects incompatible schema and generation stamps",
    rejectsIncompatibleSchemaAndGenerationStamps,
  );

  it("rejects an invalid generation timestamp", rejectsAnInvalidGenerationTimestamp);
});
