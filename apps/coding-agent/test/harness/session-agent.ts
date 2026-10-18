import type { AgentTool } from "@msa/agent-core";
import { Agent } from "@msa/agent-core";
import type { Model } from "@msa/ai";
import { Effect } from "effect";

import { AuthStorage } from "../../src/core/auth-storage.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "../model-runtime-test-utils.ts";
import type { FauxResponseInput } from "./faux-model.ts";
import { createFauxStreamFn } from "./faux-stream.ts";

export interface AgentBuildInput {
  readonly model: Model<any>;
  readonly systemPrompt: string;
  readonly tools: ReadonlyArray<AgentTool>;
  readonly responses: FauxResponseInput[];
  readonly tempDir: string;
  readonly settings: Partial<Settings> | undefined;
}

const registerProvider = Effect.fn("registerProvider")(function* (model: Model<any>) {
  const authStorage = AuthStorage.inMemory({
    [model.provider]: { type: "api_key", key: "faux-key" },
  });
  const modelRegistry = yield* Effect.promise(() => createInMemoryModelRegistry(authStorage));
  modelRegistry.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    api: model.api,
    models: [
      {
        id: model.id,
        name: model.name,
        api: model.api,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        baseUrl: model.baseUrl,
      },
    ],
  });
  return getModelRuntime(modelRegistry);
});

export const buildAgent = Effect.fn("buildAgent")(function* (input: AgentBuildInput) {
  const { streamFn, state } = createFauxStreamFn(input.responses);
  const agent = new Agent({
    getApiKey: () => "faux-key",
    initialState: {
      model: input.model,
      systemPrompt: input.systemPrompt,
      tools: [...input.tools],
    },
    streamFn,
  });
  const modelRuntime = yield* registerProvider(input.model);
  return { agent, faux: state, modelRuntime };
});
