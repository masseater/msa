import { Effect, ManagedRuntime, type Scope } from "effect";

import {
  createModelDataManifest,
  MODEL_DATA_MANIFEST_FILE,
  MODEL_DATA_SCHEMA_VERSION,
  type ModelDataStructure,
} from "../scripts/model-data.ts";
import { ScriptFiles, scriptFilesLayer } from "../scripts/script-files.ts";
import { encodeJson } from "../src/utils/json-codec.ts";

export const GENERATED_AT = "2026-07-23T10:00:00.000Z";

const runtime = ManagedRuntime.make(scriptFilesLayer);

export const runScript = <A, E>(
  effect: Effect.Effect<A, E, ScriptFiles | Scope.Scope>,
): Promise<A> => runtime.runPromise(Effect.scoped(effect));

export const failureMessage = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<string, A, R> => Effect.map(Effect.flip(effect), (error) => error.message);

export interface ModelDataFixture {
  readonly dataDir: string;
  readonly packageRoot: string;
  readonly structure: ModelDataStructure;
  readonly values: Record<string, unknown>;
}

export interface FixtureData {
  readonly dataDir: string;
  readonly structure: ModelDataStructure;
  readonly values: Record<string, unknown>;
  readonly schemaVersion?: number | undefined;
  readonly apiGroup?: string | undefined;
}

export const AGGREGATOR_SOURCE =
  'import { TEST_PROVIDER_CLASSIFIER_MODELS, TEST_PROVIDER_IMAGE_MODELS, TEST_PROVIDER_MODELS } from "./providers/test-provider.models.ts";\n';

export const writeFile = (path: string, content: string) =>
  ScriptFiles.use((files) => files.writeText({ path, content }));

export const readFile = (path: string) => ScriptFiles.use((files) => files.readText(path));

export const writeJsonFile = (path: string, value: unknown) =>
  Effect.flatMap(encodeJson(value), (content) => writeFile(path, content));

export const writeFixtureData = Effect.fn("writeFixtureData")(function* ({
  dataDir,
  structure,
  values,
  schemaVersion = MODEL_DATA_SCHEMA_VERSION,
  apiGroup = "openai-completions",
}: FixtureData) {
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
  type: "chat",
  id: "model-a",
  name: "Model A",
  api: "openai-completions",
  provider: "test-provider",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
});

export const createFixture = Effect.gen(function* () {
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
  const structure: ModelDataStructure = {
    "test-provider": { "chat:model-a": "openai-completions" },
  };
  const values: Record<string, unknown> = { "chat:model-a": chatModelA() };
  yield* writeFixtureData({ dataDir, structure, values });
  return { dataDir, packageRoot, structure, values } satisfies ModelDataFixture;
});

export function chatModel(values: Record<string, unknown>): Record<string, unknown> {
  const model = values["chat:model-a"];
  if (typeof model !== "object" || model === null) throw new Error("fixture has no chat model");
  return model as Record<string, unknown>;
}
