import { Agent } from "@msa/agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import type rpcPromptResponseHostTypes from "./rpc-prompt-response-host.types.ts";

const { currentTimeMillis } = testing;

function createAssistantMessage(text: string): AssistantMessage {
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

const createScriptedAgent = (options: rpcPromptResponseHostTypes.RuntimeHostOptions): Agent => {
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
