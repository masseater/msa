import agentModule from "@msa/agent-core";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";

import AuthStorage from "../../src/core/auth-storage.ts";
import modelRuntimeTestUtils from "../model-runtime-test-utils.ts";
import fauxStream from "./faux-stream.ts";
import type sessionAgentTypes from "./session-agent.types.ts";
const { Agent } = agentModule;

const { createInMemoryModelRegistry, getModelRuntime } = modelRuntimeTestUtils;
const { createFauxStreamFn } = fauxStream;

const registerProvider = Effect.fn("registerProvider")(function* (model: aiTypes.Model<any>) {
  const authStorage = AuthStorage.inMemory({
    [model.provider]: { key: "faux-key", type: "api_key" },
  });
  const modelRegistry = yield* Effect.promise(() => createInMemoryModelRegistry(authStorage));
  modelRegistry.registerProvider(model.provider, {
    api: model.api,
    baseUrl: model.baseUrl,
    models: [
      {
        api: model.api,
        baseUrl: model.baseUrl,
        contextWindow: model.contextWindow,
        cost: model.cost,
        id: model.id,
        input: model.input,
        maxTokens: model.maxTokens,
        name: model.name,
        reasoning: model.reasoning,
      },
    ],
  });
  return getModelRuntime(modelRegistry);
});

const buildAgent = Effect.fn("buildAgent")(function* (input: sessionAgentTypes.AgentBuildInput) {
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

const sessionAgent = {
  buildAgent,
};

export default sessionAgent;
