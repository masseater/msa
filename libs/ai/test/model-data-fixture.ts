import { Effect, ManagedRuntime, type Scope } from "effect";

import modelData from "../scripts/model-data.ts";
import type modelDataTypes from "../scripts/model-data.types.ts";
import scriptFiles from "../scripts/script-files.ts";
import type scriptFilesTypes from "../scripts/script-files.types.ts";
import jsonCodec from "../src/utils/json-codec.ts";
import type modelDataFixtureTypes from "./model-data-fixture.types.ts";

const { encodeJson } = jsonCodec;

const { MODEL_DATA_MANIFEST_FILE, MODEL_DATA_SCHEMA_VERSION, createModelDataManifest } = modelData;
const { ScriptFiles, scriptFilesLayer } = scriptFiles;

const GENERATED_AT = "2026-07-23T10:00:00.000Z";

const runtime = ManagedRuntime.make(scriptFilesLayer);

const runScript = <A, E>(
  effect: Effect.Effect<A, E, scriptFilesTypes.ScriptFiles | Scope.Scope>,
): Promise<A> => runtime.runPromise(Effect.scoped(effect));

const failureMessage = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<string, A, R> => Effect.map(Effect.flip(effect), (error) => error.message);

const AGGREGATOR_SOURCE = 'import testProviderModels from "./providers/test-provider.models.ts";\n';

const writeFile = (path: string, content: string) =>
  ScriptFiles.use((files) => files.writeText({ content, path }));

const readFile = (path: string) => ScriptFiles.use((files) => files.readText(path));

const writeJsonFile = (path: string, value: unknown) =>
  Effect.flatMap(encodeJson(value), (content) => writeFile(path, content));

const writeFixtureData = Effect.fn("writeFixtureData")(function* ({
  dataDir,
  structure,
  values,
  schemaVersion = MODEL_DATA_SCHEMA_VERSION,
  apiGroup = "openai-completions",
}: modelDataFixtureTypes.FixtureData) {
  const files = yield* ScriptFiles;
  const filename = "test-provider.json";
  const content = `${yield* encodeJson({ [apiGroup]: values })}\n`;
  yield* writeFile(files.join(dataDir, filename), content);
  const manifest = yield* createModelDataManifest(structure, { [filename]: content }, GENERATED_AT);
  manifest.schemaVersion = schemaVersion;
  yield* writeFile(
    files.join(dataDir, MODEL_DATA_MANIFEST_FILE),
    `${yield* encodeJson(manifest)}\n`,
  );
});

const chatModelA = (): Record<string, unknown> => ({
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 },
  id: "model-a",
  input: ["text"],
  maxTokens: 100,
  name: "Model A",
  provider: "test-provider",
  reasoning: false,
  type: "chat",
});

const createFixture = Effect.gen(function* () {
  const files = yield* ScriptFiles;
  const packageRoot = yield* Effect.acquireRelease(
    files.makeTempDirectory({ prefix: "msa-model-data-" }),
    (root) => Effect.ignore(files.remove(root)),
  );
  const providersDir = files.join(packageRoot, "src", "providers");
  const dataDir = files.join(providersDir, "data");
  yield* files.makeDirectory(dataDir);
  yield* writeFile(files.join(packageRoot, "src", "models.generated.ts"), AGGREGATOR_SOURCE);
  yield* writeFile(
    files.join(providersDir, "test-provider.models.ts"),
    'import values from "./data/test-provider.json" with { type: "json" };\n',
  );
  const structure: modelDataTypes.ModelDataStructure = {
    "test-provider": { "chat:model-a": "openai-completions" },
  };
  const values: Record<string, unknown> = { "chat:model-a": chatModelA() };
  yield* writeFixtureData({ dataDir, structure, values });
  return {
    dataDir,
    packageRoot,
    structure,
    values,
  } satisfies modelDataFixtureTypes.ModelDataFixture;
});

function chatModel(values: Record<string, unknown>): Record<string, unknown> {
  const model = values["chat:model-a"];
  if (typeof model !== "object" || model === null) throw new Error("fixture has no chat model");
  return model as Record<string, unknown>;
}

const modelDataFixture = {
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
};

export default modelDataFixture;
