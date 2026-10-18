import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { hydrateModelCatalog } from "../scripts/hydrate-model-catalog.ts";
import {
  MODEL_DATA_MANIFEST_FILE,
  readModelDataStructure,
  validateModelDataDirectory,
} from "../scripts/model-data.ts";
import { ScriptFiles } from "../scripts/script-files.ts";
import {
  chatModel,
  createFixture,
  failureMessage,
  readFile,
  runScript,
  writeJsonFile,
} from "./model-data-fixture.ts";

const fixtureWithCatalog = (catalog: (values: Record<string, unknown>) => unknown) =>
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    const fixture = yield* createFixture;
    const catalogPath = files.join(fixture.packageRoot, "catalog.json");
    yield* writeJsonFile(catalogPath, catalog(fixture.values));
    return { ...fixture, catalogPath, files };
  });

describe("published model catalog hydration", () => {
  it("hydrates a clean checkout deterministically without changing generated TypeScript", () =>
    runScript(
      Effect.gen(function* () {
        const { dataDir, packageRoot, structure, catalogPath, files } = yield* fixtureWithCatalog(
          (values) => ({
            "test-provider": [chatModel(values)],
            "extra-provider": [chatModel(values)],
          }),
        );
        const aggregatorPath = files.join(packageRoot, "src", "models.generated.ts");
        const aggregator = yield* readFile(aggregatorPath);
        yield* files.remove(dataDir);

        yield* hydrateModelCatalog({ packageRoot, catalogPath });
        yield* validateModelDataDirectory(structure, dataDir);
        expect(yield* readModelDataStructure(packageRoot)).toEqual(structure);
        expect(yield* readFile(aggregatorPath)).toBe(aggregator);
        const manifest = yield* readFile(files.join(dataDir, MODEL_DATA_MANIFEST_FILE));
        const provider = yield* readFile(files.join(dataDir, "test-provider.json"));
        yield* hydrateModelCatalog({ packageRoot, catalogPath });
        expect(yield* readFile(files.join(dataDir, MODEL_DATA_MANIFEST_FILE))).toBe(manifest);
        expect(yield* readFile(files.join(dataDir, "test-provider.json"))).toBe(provider);
      }),
    ));

  it("groups models by API and keys them by type and id", () =>
    runScript(
      Effect.gen(function* () {
        const { packageRoot, catalogPath } = yield* fixtureWithCatalog((values) => ({
          "test-provider": [
            chatModel(values),
            { ...chatModel(values), id: "model-b", api: "anthropic-messages" },
          ],
        }));
        yield* hydrateModelCatalog({ packageRoot, catalogPath });
        expect(yield* readModelDataStructure(packageRoot)).toEqual({
          "test-provider": {
            "chat:model-a": "openai-completions",
            "chat:model-b": "anthropic-messages",
          },
        });
      }),
    ));

  it("keys chat and image models with the same id separately", () =>
    runScript(
      Effect.gen(function* () {
        const { packageRoot, catalogPath } = yield* fixtureWithCatalog((values) => ({
          "test-provider": [
            chatModel(values),
            {
              type: "image",
              id: "model-a",
              name: "Model A Image",
              api: "openrouter-images",
              provider: "test-provider",
              baseUrl: "https://example.test/v1",
              input: ["text"],
              output: ["image"],
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        }));
        yield* hydrateModelCatalog({ packageRoot, catalogPath });
        expect(yield* readModelDataStructure(packageRoot)).toEqual({
          "test-provider": {
            "chat:model-a": "openai-completions",
            "image:model-a": "openrouter-images",
          },
        });
      }),
    ));

  it("validates without replacing existing data", () =>
    runScript(
      Effect.gen(function* () {
        const { dataDir, packageRoot, catalogPath, values, files } = yield* fixtureWithCatalog(
          (fixtureValues) => ({
            "test-provider": [
              chatModel(fixtureValues),
              { ...chatModel(fixtureValues), id: "model-b" },
            ],
          }),
        );
        const providerPath = files.join(dataDir, "test-provider.json");
        const original = yield* readFile(providerPath);
        yield* hydrateModelCatalog({ packageRoot, catalogPath, validateOnly: true });
        expect(yield* readFile(providerPath)).toBe(original);
        yield* writeJsonFile(catalogPath, { "other-provider": [chatModel(values)] });
        expect(
          yield* failureMessage(
            hydrateModelCatalog({ packageRoot, catalogPath, validateOnly: true }),
          ),
        ).toMatch(/missing provider/u);
      }),
    ));
});

describe("rejected model catalogs", () => {
  it.each([
    null,
    [],
    {},
    { "test-provider": [] },
    { "test-provider": {} },
    { "test-provider": [{ id: "x" }] },
  ])("rejects incomplete catalogs without replacing existing data: %j", (catalog) =>
    runScript(
      Effect.gen(function* () {
        const { dataDir, packageRoot, catalogPath, files } = yield* fixtureWithCatalog(
          () => catalog,
        );
        const manifestPath = files.join(dataDir, MODEL_DATA_MANIFEST_FILE);
        const original = yield* readFile(manifestPath);
        yield* Effect.flip(hydrateModelCatalog({ packageRoot, catalogPath }));
        expect(yield* readFile(manifestPath)).toBe(original);
      }),
    ),
  );

  it.each(["api", "provider", "cost"])(
    "validates model %s before replacing existing data",
    (field) =>
      runScript(
        Effect.gen(function* () {
          const { dataDir, packageRoot, catalogPath, files } = yield* fixtureWithCatalog(
            (values) => ({ "test-provider": [{ ...chatModel(values), [field]: null }] }),
          );
          const providerPath = files.join(dataDir, "test-provider.json");
          const original = yield* readFile(providerPath);
          yield* Effect.flip(hydrateModelCatalog({ packageRoot, catalogPath }));
          expect(yield* readFile(providerPath)).toBe(original);
        }),
      ),
  );
});
