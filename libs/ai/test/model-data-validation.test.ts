import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  createModelDataManifest,
  MODEL_DATA_MANIFEST_FILE,
  MODEL_DATA_SCHEMA_VERSION,
  type ModelDataStructure,
  readModelDataStructure,
  validateModelDataDirectory,
} from "../scripts/model-data.ts";
import { ScriptFiles } from "../scripts/script-files.ts";
import { decodeJsonOrDie } from "../src/utils/json-codec.ts";
import {
  AGGREGATOR_SOURCE,
  chatModel,
  createFixture,
  failureMessage,
  GENERATED_AT,
  type ModelDataFixture,
  readFile,
  runScript,
  writeFile,
  writeFixtureData,
  writeJsonFile,
} from "./model-data-fixture.ts";

const validationMessage = (fixture: ModelDataFixture) =>
  failureMessage(validateModelDataDirectory(fixture.structure, fixture.dataDir));

const rewriteManifest = (fixture: ModelDataFixture, field: string, value: unknown) =>
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    const manifestPath = files.join(fixture.dataDir, MODEL_DATA_MANIFEST_FILE);
    const manifest = yield* Effect.flatMap(readFile(manifestPath), decodeJsonOrDie);
    yield* writeJsonFile(manifestPath, {
      ...(manifest as Record<string, unknown>),
      [field]: value,
    });
  });

describe("generated model data structure", () => {
  it("reads and validates API-grouped model data", () =>
    runScript(
      Effect.gen(function* () {
        const { dataDir, packageRoot, structure } = yield* createFixture;
        expect(yield* readModelDataStructure(packageRoot)).toEqual(structure);
        yield* validateModelDataDirectory(structure, dataDir);
      }),
    ));

  it("rejects a missing model data directory", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        yield* ScriptFiles.use((files) => files.remove(fixture.dataDir));
        expect(yield* validationMessage(fixture)).toContain("does not exist");
      }),
    ));

  it("rejects missing provider shards imported by the aggregator", () =>
    runScript(
      Effect.gen(function* () {
        const { packageRoot } = yield* createFixture;
        const files = yield* ScriptFiles;
        yield* writeFile(
          files.join(packageRoot, "src", "models.generated.ts"),
          `${AGGREGATOR_SOURCE}import { MISSING_CLASSIFIER_MODELS, MISSING_IMAGE_MODELS, MISSING_MODELS } from "./providers/missing.models.ts";\n`,
        );
        expect(yield* failureMessage(readModelDataStructure(packageRoot))).toContain(
          "aggregator and provider shards do not match",
        );
      }),
    ));
});

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

  it("rejects a model without a known type", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        delete chatModel(fixture.values)["type"];
        yield* writeFixtureData(fixture);
        expect(yield* validationMessage(fixture)).toContain(
          'expected "chat", "image", or "classifier"',
        );
      }),
    ));

  it("rejects output modalities on chat models", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        chatModel(fixture.values)["output"] = ["text"];
        yield* writeFixtureData(fixture);
        expect(yield* validationMessage(fixture)).toContain("unsupported output modalities");
      }),
    ));
});

describe("generated image and classifier validation", () => {
  it("validates image models with output modalities and without chat limits", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        const structure: ModelDataStructure = {
          "test-provider": { "image:image-a": "test-images" },
        };
        const image: Record<string, unknown> = {
          type: "image",
          id: "image-a",
          name: "Image A",
          api: "test-images",
          provider: "test-provider",
          baseUrl: "https://example.test/v1",
          input: ["text"],
          output: ["image", "text"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        };
        const validate = Effect.andThen(
          Effect.suspend(() =>
            writeFixtureData({
              dataDir: fixture.dataDir,
              structure,
              values: { "image:image-a": image },
              apiGroup: "test-images",
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
    ));

  it("validates classifier models without chat output limits", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        const structure: ModelDataStructure = {
          "test-provider": { "classifier:classifier-a": "test-classifier" },
        };
        yield* writeFixtureData({
          dataDir: fixture.dataDir,
          structure,
          values: {
            "classifier:classifier-a": {
              type: "classifier",
              id: "classifier-a",
              name: "Classifier A",
              api: "test-classifier",
              provider: "test-provider",
              baseUrl: "https://example.test/v1",
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
            },
          },
          apiGroup: "test-classifier",
        });
        yield* validateModelDataDirectory(structure, fixture.dataDir);
      }),
    ));
});

describe("generated model grouping validation", () => {
  it("rejects a model in the wrong API group", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        yield* writeFixtureData({ ...fixture, apiGroup: "anthropic-messages" });
        expect(yield* validationMessage(fixture)).toContain("grouped under API");
      }),
    ));

  it("rejects duplicate model IDs across API groups", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        const files = yield* ScriptFiles;
        const filename = "test-provider.json";
        const groups = {
          "openai-completions": fixture.values,
          "anthropic-messages": fixture.values,
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
    ));
});

describe("generated model manifest validation", () => {
  it("rejects missing model IDs and stale file hashes", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        const files = yield* ScriptFiles;
        yield* writeFile(files.join(fixture.dataDir, "test-provider.json"), "{}\n");
        expect(yield* validationMessage(fixture)).toMatch(/manifest hash|model IDs/u);
      }),
    ));

  it("rejects incompatible schema and generation stamps", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        yield* writeFixtureData({ ...fixture, schemaVersion: MODEL_DATA_SCHEMA_VERSION + 1 });
        expect(yield* validationMessage(fixture)).toContain("model data schema");
        yield* rewriteManifest(fixture, "structureHash", "stale");
        expect(yield* validationMessage(fixture)).toContain("generation stamp");
      }),
    ));

  it("rejects an invalid generation timestamp", () =>
    runScript(
      Effect.gen(function* () {
        const fixture = yield* createFixture;
        yield* rewriteManifest(fixture, "generatedAt", "invalid");
        expect(yield* validationMessage(fixture)).toContain("generation timestamp");
      }),
    ));
});
