import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { vi } from "vite-plus/test";

import type harnessTypes from "./harness.types.ts";

const { createAssistantMessageEventStream, fauxAssistantMessage } = ai;

const { currentTimeMillis } = testing;

function createUsage(totalTokens: number) {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: totalTokens,
    output: 0,
    totalTokens,
  };
}

function createAssistant(
  harness: harnessTypes.Harness,
  options: {
    stopReason?: aiTypes.AssistantMessage["stopReason"];
    errorMessage?: string;
    totalTokens?: number;
    timestamp?: number;
  },
): aiTypes.AssistantMessage {
  const model = harness.getModel();
  return {
    ...fauxAssistantMessage("", {
      ...(options.stopReason === undefined ? {} : { stopReason: options.stopReason }),
      ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
      ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    }),
    api: model.api,
    model: model.id,
    provider: model.provider,
    usage: createUsage(options.totalTokens ?? 0),
  };
}

function useSummaryStreamFn(
  harness: harnessTypes.Harness,
  summary: string,
  onRequest?: (
    context: aiTypes.TranscriptContext,
    options: aiTypes.SimpleStreamOptions | undefined,
  ) => void,
): () => number {
  let callCount = 0;
  harness.session.agent.streamFunction = (model, context, options) => {
    callCount++;
    onRequest?.(context, options);
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      const message: aiTypes.AssistantMessage = {
        ...fauxAssistantMessage(summary),
        api: model.api,
        model: model.id,
        provider: model.provider,
        usage: createUsage(10),
      };
      stream.push({ message, reason: "stop", type: "done" });
    });
    return stream;
  };
  return () => callCount;
}

function seedCompactableSession(harness: harnessTypes.Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = currentTimeMillis();
  harness.sessionManager.appendMessage({
    content: [{ text: "message to compact", type: "text" }],
    role: "user",
    timestamp: now - 1000,
  });
  const assistant = createAssistant(harness, {
    stopReason: "stop",
    timestamp: now - 500,
    totalTokens: 100,
  });
  assistant.content = [{ text: "assistant response to compact", type: "text" }];
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

const harnesses: harnessTypes.Harness[] = [];

const afterEachHook = () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

const agentSessionCompactionSupport = {
  afterEachHook,
  createAssistant,
  createUsage,
  harnesses,
  seedCompactableSession,
  useSummaryStreamFn,
};

export default agentSessionCompactionSupport;
