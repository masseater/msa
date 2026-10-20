import {
  type AssistantImages,
  type ClassifierModel,
  type ImageModel,
  InMemoryModelsStore,
} from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const { awaited, joinPath, makeTempDir, removeDirs, toJsonText, writeTextFile } = testing;

const tempDirs: string[] = [];

const removeRuntimeDirs: Effect.Effect<void> = Effect.suspend(() => removeDirs(tempDirs.splice(0)));

const createRuntime = (modelsJson?: object): Effect.Effect<ModelRuntime> =>
  Effect.gen(function* () {
    let modelsPath: string | null = null;
    if (modelsJson !== undefined) {
      const dir = yield* makeTempDir("msa-images-");
      tempDirs.push(dir);
      modelsPath = joinPath(dir, "models.json");
      yield* writeTextFile(modelsPath, yield* toJsonText(modelsJson));
    }
    return yield* awaited(
      ModelRuntime.create({
        allowModelNetwork: false,
        credentials: AuthStorage.inMemory(),
        modelsPath,
        modelsStore: new InMemoryModelsStore(),
      }),
    );
  });

const image = (provider: string, id: string): ImageModel<"test-images"> => ({
  api: "test-images" as const,
  baseUrl: "https://images.test/v1",
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  name: id,
  output: ["image"],
  provider,
  type: "image" as const,
});

const classifier = (provider: string, id: string): ClassifierModel<"test-classifier"> => ({
  api: "test-classifier" as const,
  baseUrl: "https://classifier.test/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  name: id,
  provider,
  type: "classifier" as const,
});

const models = { classifier, image };

const context = { input: [{ text: "a red circle", type: "text" as const }] };

const classifierContext = {
  questions: {
    approved: {
      criteria: { false: "No approval", true: "Approval" },
      instructions: "Does this express approval?",
      type: "bool" as const,
    },
  },
  state: { text: "Looks good" },
};

function okImageResult(model: ImageModel<string>): AssistantImages {
  return {
    api: model.api,
    model: model.id,
    output: [{ data: "aGk=", mimeType: "image/png", type: "image" as const }],
    provider: model.provider,
    stopReason: "stop" as const,
    timestamp: 0,
  };
}

const modelRuntimeImagesSupport = {
  classifierContext,
  context,
  createRuntime,
  models,
  okImageResult,
  removeRuntimeDirs,
};

export default modelRuntimeImagesSupport;
