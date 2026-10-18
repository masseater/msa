import type { AgentMessage, AgentToolResult } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import { currentTimeMillis, nowIso } from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import {
  type SessionEntry,
  sessionEntryToContextMessages,
} from "../../src/core/session-manager.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness } from "./harness.ts";

function messageEntry(message: Record<string, unknown>): SessionEntry {
  return {
    type: "message",
    id: "entry-1",
    parentId: null,
    timestamp: nowIso(),
    message,
  } as unknown as SessionEntry;
}

const normalizesToolResultsFromUntypedTools = Effect.gen(function* () {
  const extensionFactories: ExtensionFactory[] = [
    (msa) => {
      msa.registerTool({
        name: "web_search",
        label: "Web Search",
        description: "Custom tool that returns a result without content",
        parameters: Type.Object({}),

        execute: () => Promise.resolve({ details: {} } as unknown as AgentToolResult<unknown>),
      });
    },
  ];
  const harness = yield* Effect.promise(() => createHarness({ extensionFactories }));

  try {
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("web_search", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);

    yield* Effect.promise(() => harness.session.prompt("search something"));

    const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]?.content).toEqual([]);

    expect(harness.getPendingResponseCount()).toBe(0);
  } finally {
    harness.cleanup();
  }
});

const normalizesNullContentInMessageEnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const extensionFactories: ExtensionFactory[] = [
    (msa) => {
      msa.on("message_end", (event) =>
        runPromise(
          Effect.sync(() => {
            if (event.message.role !== "assistant") return undefined;

            return {
              message: { ...event.message, content: null } as unknown as AgentMessage,
            };
          }),
        ),
      );
    },
  ];
  const harness = yield* Effect.promise(() => createHarness({ extensionFactories }));

  try {
    harness.setResponses([fauxAssistantMessage("hello")]);
    yield* Effect.promise(() => harness.session.prompt("hi"));

    const assistantMessages = harness.session.messages.filter(
      (message) => message.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toEqual([]);
  } finally {
    harness.cleanup();
  }
});

const normalizesNullContentInCustomMessages = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());

  try {
    yield* Effect.promise(() =>
      harness.session.sendCustomMessage({
        customType: "test",
        content: null as unknown as string,
        display: false,
        details: undefined,
      }),
    );

    const customMessages = harness.session.messages.filter((message) => message.role === "custom");
    expect(customMessages).toHaveLength(1);
    expect(customMessages[0]?.content).toEqual([]);
  } finally {
    harness.cleanup();
  }
});

const normalizesNullOrMissingContentWhen = () => {
  const badMessages = [
    { role: "user", content: null, timestamp: currentTimeMillis() },
    {
      role: "assistant",
      content: null,
      api: "openai-completions",
      provider: "openai",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: currentTimeMillis(),
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "web_search",
      isError: false,
      timestamp: currentTimeMillis(),
    },
  ];

  for (const badMessage of badMessages) {
    const [message] = sessionEntryToContextMessages(messageEntry(badMessage));
    expect(message).toMatchObject({ role: badMessage.role, content: [] });
  }
};

const normalizesNullContentWhenLoadingCustom = () => {
  const entry = {
    type: "custom_message",
    id: "entry-1",
    parentId: null,
    timestamp: nowIso(),
    customType: "test",
    content: null,
    display: false,
    details: undefined,
  } as unknown as SessionEntry;

  const [message] = sessionEntryToContextMessages(entry);
  expect(message).toMatchObject({ role: "custom", content: [] });
};

describe("lax message content handling", () => {
  it("normalizes tool results from untyped tools that omit content", () =>
    Effect.runPromise(normalizesToolResultsFromUntypedTools));
  it("normalizes null content in message_end extension replacements", () =>
    Effect.runPromise(normalizesNullContentInMessageEnd));
  it("normalizes null content in custom messages from extensions", () =>
    Effect.runPromise(normalizesNullContentInCustomMessages));
  it(
    "normalizes null or missing content when loading session message entries",
    normalizesNullOrMissingContentWhen,
  );
  it(
    "normalizes null content when loading custom message entries",
    normalizesNullContentWhenLoadingCustom,
  );
  it("keeps valid message content untouched when loading session entries", () => {
    const [message] = sessionEntryToContextMessages(
      messageEntry({ role: "user", content: "hello", timestamp: currentTimeMillis() }),
    );
    expect(message).toMatchObject({ role: "user", content: "hello" });
  });
});
