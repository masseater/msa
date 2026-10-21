import agent from "@msa/agent-core";
import type agentTypes from "@msa/agent-core/index.types";
import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import type rpcPromptResponseHostTypes from "./rpc-prompt-response-host.types.ts";

const { createAssistantMessageEventStream, getModel } = compat;

const { Agent } = agent;

const { currentTimeMillis } = testing;

function createAssistantMessage(text: string): compatTypes.AssistantMessage {
  return {
    api: "anthropic-messages",
    content: [{ text, type: "text" }],
    model: "claude-sonnet-4-5",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const pushAfter = (ms: number, push: () => void): void => {
  Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(push))));
};

const createScriptedAgent = (
  options: rpcPromptResponseHostTypes.RuntimeHostOptions,
): agentTypes.Agent => {
  const model = options.model ?? getModel("anthropic-api", "claude-sonnet-4-5");
  if (model === undefined) {
    throw new Error("Test model not found");
  }
  return new Agent({
    getApiKey: () => "test-key",
    initialState: { model, systemPrompt: "Test", tools: [] },
    streamFn: (_model, _context, _options) => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ partial: createAssistantMessage(""), type: "start" });
        pushAfter(options.responseDelayMs, () => {
          stream.push({ message: createAssistantMessage("done"), reason: "stop", type: "done" });
        });
      });
      return stream;
    },
  });
};

const rpcPromptResponseAgent = {
  createScriptedAgent,
};

export default rpcPromptResponseAgent;
