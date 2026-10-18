import {
  type AssistantImages,
  type ClassifierModel,
  type ImageModel,
  InMemoryModelsStore,
} from "@msa/ai";
import {
  awaited,
  joinPath,
  makeTempDir,
  removeDirs,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const tempDirs: string[] = [];

export const removeRuntimeDirs: Effect.Effect<void> = Effect.suspend(() =>
  removeDirs(tempDirs.splice(0)),
);

export const createRuntime = (modelsJson?: object): Effect.Effect<ModelRuntime> =>
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
        credentials: AuthStorage.inMemory(),
        modelsStore: new InMemoryModelsStore(),
        modelsPath,
        allowModelNetwork: false,
      }),
    );
  });

const image = (provider: string, id: string): ImageModel<"test-images"> => ({
  type: "image" as const,
  id,
  name: id,
  api: "test-images" as const,
  provider,
  baseUrl: "https://images.test/v1",
  input: ["text"],
  output: ["image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const classifier = (provider: string, id: string): ClassifierModel<"test-classifier"> => ({
  type: "classifier" as const,
  id,
  name: id,
  api: "test-classifier" as const,
  provider,
  baseUrl: "https://classifier.test/v1",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
});

export const models = { image, classifier };

export const context = { input: [{ type: "text" as const, text: "a red circle" }] };

export const classifierContext = {
  state: { text: "Looks good" },
  questions: {
    approved: {
      type: "bool" as const,
      instructions: "Does this express approval?",
      criteria: { true: "Approval", false: "No approval" },
    },
  },
};

export function okImageResult(model: ImageModel<string>): AssistantImages {
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [{ type: "image" as const, data: "aGk=", mimeType: "image/png" }],
    stopReason: "stop" as const,
    timestamp: 0,
  };
}
