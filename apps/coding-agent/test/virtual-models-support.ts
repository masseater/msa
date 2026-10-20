import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { type ModelRouteRequest, type VirtualModelDefinition } from "../src/core/virtual-models.ts";

const { InMemoryModelsStore, fauxAssistantMessage, fauxProvider } = ai;

const { awaited, runTest } = testing;

function createRuntime(requests: ModelRouteRequest[] = []) {
  return runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials: AuthStorage.inMemory(),
          modelsPath: null,
          modelsStore: new InMemoryModelsStore(),
        }),
      );
      const faux = fauxProvider({
        models: [
          { contextWindow: 1000, id: "small", input: ["text"], maxTokens: 100 },
          {
            contextWindow: 50_000,
            id: "large",
            input: ["text", "image"],
            maxTokens: 5000,
            reasoning: true,
          },
        ],
      });
      runtime.registerNativeProvider(faux.provider);
      const definition: VirtualModelDefinition = {
        id: "auto",
        name: "Auto",
        provider: "router",
        route(request) {
          requests.push(request);
          const model = runtime.getModel(
            "faux",
            request.thinkingLevel === "high" ? "large" : "small",
          )!;
          return { model, thinkingLevel: "high" };
        },
        thinkingLevels: ["low", "high"],
      };
      runtime.registerVirtualModel(definition);
      yield* awaited(runtime.refresh({ allowNetwork: false }));
      return yield* awaited({
        definition,
        faux,
        runtime,
        virtual: runtime.getModel("router", "auto")!,
      });
    }),
  );
}

function assistantFrom(model: aiTypes.Model<string>, text: string): aiTypes.AssistantMessage {
  return {
    ...fauxAssistantMessage(text),
    api: model.api,
    model: model.id,
    provider: model.provider,
  };
}

const virtualModelsSupport = {
  assistantFrom,
  createRuntime,
};

export default virtualModelsSupport;
