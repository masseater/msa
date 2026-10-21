import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import sessionContext from "../../src/core/session-manager/session-context.ts";
import type srcTypes from "../../src/index.types.ts";
import harnessModule from "./harness.ts";

const { sessionEntryToContextMessages } = sessionContext;

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness } = harnessModule;

const { currentTimeMillis, nowIso } = testing;

function messageEntry(message: Record<string, unknown>): sessionManagerTypes.SessionEntry {
  return {
    id: "entry-1",
    message,
    parentId: null,
    timestamp: nowIso(),
    type: "message",
  } as unknown as sessionManagerTypes.SessionEntry;
}

const normalizesToolResultsFromUntypedTools = Effect.gen(function* () {
  const extensionFactories: srcTypes.ExtensionFactory[] = [
    (msa) => {
      msa.registerTool({
        description: "Custom tool that returns a result without content",
        execute: () =>
          Promise.resolve({ details: {} } as unknown as agentTypes.AgentToolResult<unknown>),
        label: "Web Search",
        name: "web_search",
        parameters: Type.Object({}),
      });
    },
  ];
  const harness = yield* Effect.promise(() => createHarness({ extensionFactories }));

  try {
    harness.setResponses([
      fauxAssistantMessage(fauxToolCall("web_search", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);

    yield* Effect.promise(() => harness.session.run.prompting.prompt("search something"));

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
  const extensionFactories: srcTypes.ExtensionFactory[] = [
    (msa) => {
      msa.on("message_end", (event) =>
        runPromise(
          Effect.sync(() => {
            if (event.message.role !== "assistant") return undefined;

            return {
              message: { ...event.message, content: null } as unknown as agentTypes.AgentMessage,
            };
          }),
        ),
      );
    },
  ];
  const harness = yield* Effect.promise(() => createHarness({ extensionFactories }));

  try {
    harness.setResponses([fauxAssistantMessage("hello")]);
    yield* Effect.promise(() => harness.session.run.prompting.prompt("hi"));

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
      harness.session.run.prompting.sendCustomMessage({
        content: null as unknown as string,
        customType: "test",
        details: undefined,
        display: false,
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
    { content: null, role: "user", timestamp: currentTimeMillis() },
    {
      api: "openai-completions",
      content: null,
      model: "test-model",
      provider: "openai",
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
    },
    {
      isError: false,
      role: "toolResult",
      timestamp: currentTimeMillis(),
      toolCallId: "call_1",
      toolName: "web_search",
    },
  ];

  for (const badMessage of badMessages) {
    const [message] = sessionEntryToContextMessages(messageEntry(badMessage));
    expect(message).toMatchObject({ content: [], role: badMessage.role });
  }
};

const normalizesNullContentWhenLoadingCustom = () => {
  const entry = {
    content: null,
    customType: "test",
    details: undefined,
    display: false,
    id: "entry-1",
    parentId: null,
    timestamp: nowIso(),
    type: "custom_message",
  } as unknown as sessionManagerTypes.SessionEntry;

  const [message] = sessionEntryToContextMessages(entry);
  expect(message).toMatchObject({ content: [], role: "custom" });
};

const normalizesToolResultsFromUntypedToolsThat = () =>
  Effect.runPromise(normalizesToolResultsFromUntypedTools);

const normalizesNullContentInMessageEndExtension = () =>
  Effect.runPromise(normalizesNullContentInMessageEnd);

const normalizesNullContentInCustomMessagesFrom = () =>
  Effect.runPromise(normalizesNullContentInCustomMessages);

const keepsValidMessageContentUntouchedWhenLoading = () => {
  const [message] = sessionEntryToContextMessages(
    messageEntry({ content: "hello", role: "user", timestamp: currentTimeMillis() }),
  );
  expect(message).toMatchObject({ content: "hello", role: "user" });
};

describe("lax message content handling", () => {
  it(
    "normalizes tool results from untyped tools that omit content",
    normalizesToolResultsFromUntypedToolsThat,
  );
  it(
    "normalizes null content in message_end extension replacements",
    normalizesNullContentInMessageEndExtension,
  );
  it(
    "normalizes null content in custom messages from extensions",
    normalizesNullContentInCustomMessagesFrom,
  );
  it(
    "normalizes null or missing content when loading session message entries",
    normalizesNullOrMissingContentWhen,
  );
  it(
    "normalizes null content when loading custom message entries",
    normalizesNullContentWhenLoadingCustom,
  );
  it(
    "keeps valid message content untouched when loading session entries",
    keepsValidMessageContentUntouchedWhenLoading,
  );
});
